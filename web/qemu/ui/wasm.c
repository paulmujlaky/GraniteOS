#include "qemu/osdep.h"

#include <emscripten.h>
#include <stdatomic.h>

#include "qemu/module.h"
#include "ui/console.h"
#include "ui/input.h"
#include "ui/surface.h"

typedef enum WasmInputType {
    WASM_INPUT_KEY = 1,
    WASM_INPUT_POINTER,
    WASM_INPUT_BUTTON,
    WASM_INPUT_WHEEL,
    WASM_INPUT_RESIZE,
} WasmInputType;

typedef struct WasmInputEvent {
    int type;
    int a;
    int b;
    int c;
    int d;
} WasmInputEvent;

#define WASM_INPUT_CAPACITY 512
#define WASM_DAMAGE_CAPACITY 8

typedef struct WasmInputQueue {
    _Atomic uint32_t read;
    _Atomic uint32_t write;
    WasmInputEvent events[WASM_INPUT_CAPACITY];
} WasmInputQueue;

typedef struct WasmDamage {
    int x;
    int y;
    int width;
    int height;
} WasmDamage;

typedef struct WasmDisplay {
    DisplayChangeListener dcl;
    DisplaySurface *surface;
    WasmDamage damage[WASM_DAMAGE_CAPACITY];
    int damage_count;
    int reconcile_frames;
} WasmDisplay;

static WasmInputQueue wasm_input_queue;
EM_JS(void, wasm_bridge_init,
      (const char *channel_name, WasmInputQueue *input_queue,
       int input_capacity), {
    const name = UTF8ToString(channel_name);
    const channel = new BroadcastChannel(name);
    const bridge = { channel };

    globalThis.graniteWasmDisplay = bridge;
    channel.postMessage({
        source: 'qemu',
        type: 'ready',
        inputOffset: input_queue,
        inputCapacity: input_capacity,
    });
});

EM_JS(void, wasm_bridge_mode,
      (int width, int height), {
    const bridge = globalThis.graniteWasmDisplay;

    if (bridge) {
        bridge.channel.postMessage({
            source: 'qemu',
            type: 'mode',
            width,
            height,
        });
    }
});

EM_JS(void, wasm_bridge_frame,
      (const uint8_t *source, int stride,
       int x, int y, int width, int height), {
    const bridge = globalThis.graniteWasmDisplay;

    if (!bridge || width <= 0 || height <= 0) {
        return;
    }

    const rowBytes = width * 4;
    const pixels = new Uint8Array(rowBytes * height);

    for (let row = 0; row < height; row++) {
        const rowSource = source + (y + row) * stride + x * 4;
        pixels.set(HEAPU8.subarray(rowSource, rowSource + rowBytes),
                   row * rowBytes);
    }

    bridge.channel.postMessage({
        source: 'qemu',
        type: 'frame',
        x,
        y,
        width,
        height,
        pixels,
    });
});

EM_JS(void, wasm_bridge_cursor,
      (const uint8_t *source, int width, int height, int hot_x, int hot_y), {
    const bridge = globalThis.graniteWasmDisplay;

    if (!bridge) {
        return;
    }

    const pixels = new Uint8Array(width * height * 4);
    pixels.set(HEAPU8.subarray(source, source + pixels.length));

    bridge.channel.postMessage({
        source: 'qemu',
        type: 'cursor',
        width,
        height,
        hotX: hot_x,
        hotY: hot_y,
        pixels,
    });
});

EM_JS(void, wasm_bridge_cursor_position, (int x, int y, int visible), {
    const bridge = globalThis.graniteWasmDisplay;

    if (bridge) {
        bridge.channel.postMessage({
            source: 'qemu',
            type: 'cursor-position',
            x,
            y,
            visible: !!visible,
        });
    }
});

static void wasm_send_pointer(WasmDisplay *display, int x, int y)
{
    DisplaySurface *surface = display->surface;

    if (!surface) {
        return;
    }

    int width = surface_width(surface);
    int height = surface_height(surface);

    x = MIN(MAX(x, 0), width - 1);
    y = MIN(MAX(y, 0), height - 1);

    qemu_input_queue_abs(display->dcl.con, INPUT_AXIS_X, x, 0, width);
    qemu_input_queue_abs(display->dcl.con, INPUT_AXIS_Y, y, 0, height);
    qemu_input_event_sync();
}

static void wasm_send_button(WasmDisplay *display, int button, bool down)
{
    if (button < INPUT_BUTTON_LEFT || button > INPUT_BUTTON_RIGHT) {
        return;
    }

    qemu_input_queue_btn(display->dcl.con, button, down);
    qemu_input_event_sync();
}

static void wasm_send_wheel(WasmDisplay *display, int delta)
{
    InputButton button = delta < 0 ? INPUT_BUTTON_WHEEL_UP
                                   : INPUT_BUTTON_WHEEL_DOWN;

    if (!delta) {
        return;
    }

    qemu_input_queue_btn(display->dcl.con, button, true);
    qemu_input_event_sync();
    qemu_input_queue_btn(display->dcl.con, button, false);
    qemu_input_event_sync();
}

static void wasm_resize(WasmDisplay *display, int width, int height)
{
    QemuUIInfo info = {
        .width = width,
        .height = height,
        .refresh_rate = 60,
    };

    if (width < 320 || height < 200 || width > 4096 || height > 4096) {
        return;
    }

    dpy_set_ui_info(display->dcl.con, &info, false);
}

static void wasm_drain_input(WasmDisplay *display)
{
    uint32_t read = atomic_load_explicit(&wasm_input_queue.read,
                                         memory_order_relaxed);
    uint32_t write = atomic_load_explicit(&wasm_input_queue.write,
                                          memory_order_acquire);
    int pointer_x = 0;
    int pointer_y = 0;
    bool pointer_pending = false;
    bool had_input = false;

    while (read != write) {
        WasmInputEvent event = wasm_input_queue.events[read];

        had_input = true;

        read = (read + 1) % WASM_INPUT_CAPACITY;
        atomic_store_explicit(&wasm_input_queue.read, read,
                              memory_order_release);

        if (event.type == WASM_INPUT_POINTER) {
            pointer_x = event.a;
            pointer_y = event.b;
            pointer_pending = true;
            write = atomic_load_explicit(&wasm_input_queue.write,
                                         memory_order_acquire);
            continue;
        }

        if (pointer_pending) {
            wasm_send_pointer(display, pointer_x, pointer_y);
            pointer_pending = false;
        }

        switch (event.type) {
        case WASM_INPUT_KEY: {
            int qcode = qemu_input_linux_to_qcode(event.a);

            if (qcode > 0 && qcode < Q_KEY_CODE__MAX) {
                qemu_input_event_send_key_qcode(display->dcl.con,
                                                qcode, event.b != 0);
            }
            break;
        }
        case WASM_INPUT_BUTTON:
            wasm_send_button(display, event.a, event.b != 0);
            break;
        case WASM_INPUT_WHEEL:
            wasm_send_wheel(display, event.a);
            break;
        case WASM_INPUT_RESIZE:
            wasm_resize(display, event.a, event.b);
            break;
        default:
            break;
        }

        write = atomic_load_explicit(&wasm_input_queue.write,
                                     memory_order_acquire);
    }

    if (pointer_pending) {
        wasm_send_pointer(display, pointer_x, pointer_y);
    }

    if (had_input) {
        display->reconcile_frames = 3;
    }
}

static bool wasm_damage_touches(WasmDamage a, WasmDamage b)
{
    return a.x <= b.x + b.width && b.x <= a.x + a.width &&
           a.y <= b.y + b.height && b.y <= a.y + a.height;
}

static WasmDamage wasm_damage_cover(WasmDamage a, WasmDamage b)
{
    int x = MIN(a.x, b.x);
    int y = MIN(a.y, b.y);
    int x2 = MAX(a.x + a.width, b.x + b.width);
    int y2 = MAX(a.y + a.height, b.y + b.height);

    return (WasmDamage) {
        .x = x,
        .y = y,
        .width = x2 - x,
        .height = y2 - y,
    };
}

static uint64_t wasm_damage_area(WasmDamage damage)
{
    return (uint64_t)damage.width * damage.height;
}

static void wasm_damage_add(WasmDisplay *display, WasmDamage damage)
{
    for (int index = 0; index < display->damage_count;) {
        if (!wasm_damage_touches(display->damage[index], damage)) {
            index++;
            continue;
        }

        damage = wasm_damage_cover(display->damage[index], damage);
        display->damage[index] = display->damage[--display->damage_count];
        index = 0;
    }

    if (display->damage_count < WASM_DAMAGE_CAPACITY) {
        display->damage[display->damage_count++] = damage;
        return;
    }

    int best = 0;
    uint64_t best_cost = UINT64_MAX;

    for (int index = 0; index < display->damage_count; index++) {
        WasmDamage covered = wasm_damage_cover(display->damage[index], damage);
        uint64_t cost = wasm_damage_area(covered) -
                        wasm_damage_area(display->damage[index]);

        if (cost < best_cost) {
            best = index;
            best_cost = cost;
        }
    }

    display->damage[best] = wasm_damage_cover(display->damage[best], damage);
}

static void wasm_flush_damage(WasmDisplay *display)
{
    DisplaySurface *surface = display->surface;

    if (!surface || surface_format(surface) != PIXMAN_x8r8g8b8) {
        display->damage_count = 0;
        return;
    }

    for (int index = 0; index < display->damage_count; index++) {
        WasmDamage damage = display->damage[index];

        wasm_bridge_frame(surface_data(surface), surface_stride(surface),
                          damage.x, damage.y,
                          damage.width, damage.height);
    }

    display->damage_count = 0;
}

static void wasm_refresh(DisplayChangeListener *dcl)
{
    WasmDisplay *display = container_of(dcl, WasmDisplay, dcl);

    wasm_drain_input(display);
    graphic_hw_update(dcl->con);

    if (display->reconcile_frames > 0 && display->surface) {
        display->damage_count = 0;
        wasm_damage_add(display, (WasmDamage) {
            .x = 0,
            .y = 0,
            .width = surface_width(display->surface),
            .height = surface_height(display->surface),
        });
        display->reconcile_frames--;
    }

    wasm_flush_damage(display);
}

static void wasm_gfx_update(DisplayChangeListener *dcl,
                            int x, int y, int width, int height)
{
    WasmDisplay *display = container_of(dcl, WasmDisplay, dcl);
    DisplaySurface *surface = display->surface;

    if (!surface || surface_format(surface) != PIXMAN_x8r8g8b8) {
        return;
    }

    int surface_width_px = surface_width(surface);
    int surface_height_px = surface_height(surface);
    int x2 = MIN(x + width, surface_width_px);
    int y2 = MIN(y + height, surface_height_px);

    x = MAX(x, 0);
    y = MAX(y, 0);
    width = x2 - x;
    height = y2 - y;

    if (width <= 0 || height <= 0) {
        return;
    }

    wasm_damage_add(display, (WasmDamage) {
        .x = x,
        .y = y,
        .width = width,
        .height = height,
    });
}

static void wasm_gfx_switch(DisplayChangeListener *dcl,
                            DisplaySurface *surface)
{
    WasmDisplay *display = container_of(dcl, WasmDisplay, dcl);

    display->surface = surface;
    display->damage_count = 0;
    display->reconcile_frames = 0;

    if (surface) {
        wasm_bridge_mode(surface_width(surface), surface_height(surface));
        wasm_damage_add(display, (WasmDamage) {
            .x = 0,
            .y = 0,
            .width = surface_width(surface),
            .height = surface_height(surface),
        });
    }
}

static bool wasm_gfx_check_format(DisplayChangeListener *dcl,
                                  pixman_format_code_t format)
{
    return format == PIXMAN_x8r8g8b8;
}

static void wasm_mouse_set(DisplayChangeListener *dcl, int x, int y, int on)
{
    wasm_bridge_cursor_position(x, y, on);
}

static void wasm_cursor_define(DisplayChangeListener *dcl, QEMUCursor *cursor)
{
    wasm_bridge_cursor((const uint8_t *)cursor->data,
                       cursor->width, cursor->height,
                       cursor->hot_x, cursor->hot_y);
}

static const DisplayChangeListenerOps wasm_ops = {
    .dpy_name = "wasm",
    .dpy_refresh = wasm_refresh,
    .dpy_gfx_update = wasm_gfx_update,
    .dpy_gfx_switch = wasm_gfx_switch,
    .dpy_gfx_check_format = wasm_gfx_check_format,
    .dpy_mouse_set = wasm_mouse_set,
    .dpy_cursor_define = wasm_cursor_define,
};

static void wasm_display_init(DisplayState *ds, DisplayOptions *opts)
{
    const char *channel = opts->u.wasm.channel
        ? opts->u.wasm.channel
        : "graniteos-display";

    wasm_bridge_init(channel, &wasm_input_queue, WASM_INPUT_CAPACITY);

    for (int index = 0;; index++) {
        QemuConsole *console = qemu_console_lookup_by_index(index);

        if (!console || !qemu_console_is_graphic(console)) {
            break;
        }

        WasmDisplay *display = g_new0(WasmDisplay, 1);

        display->dcl.con = console;
        display->dcl.ops = &wasm_ops;
        display->dcl.update_interval = 16;
        register_displaychangelistener(&display->dcl);
    }
}

static QemuDisplay qemu_display_wasm = {
    .type = DISPLAY_TYPE_WASM,
    .init = wasm_display_init,
};

static void register_wasm(void)
{
    qemu_display_register(&qemu_display_wasm);
}

type_init(register_wasm);
