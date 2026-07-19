#!/usr/bin/env bash

set -euo pipefail

expected_commit='0ef7b4e2814b231705d8371dd7997f5b72e70baf'
image='granite-qemu-wasm-build:0ef7b4e'
source_repository='https://github.com/ktock/qemu-wasm.git'

if (( $# != 0 )); then
    printf 'Usage: %s\n' "${0##*/}" >&2
    exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
web_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
patch_dir="$web_root/qemu"
output_dir="$web_root/frontend/public/qemu/wasm"

for required_command in docker git; do
    if ! command -v "$required_command" >/dev/null 2>&1; then
        printf 'Required command is unavailable: %s\n' "$required_command" >&2
        exit 1
    fi
done

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/granite-qemu.XXXXXX")
cleanup() {
    rm -rf -- "$work_dir"
}
trap cleanup EXIT

source_dir="$work_dir/qemu-wasm"
archive="$work_dir/source.tar"

printf 'Fetching QEMU Wasm source at %s...\n' "$expected_commit"
git init --quiet "$source_dir"
git -C "$source_dir" remote add origin "$source_repository"
git -C "$source_dir" fetch --quiet --depth=1 origin "$expected_commit"
git -C "$source_dir" checkout --quiet --detach FETCH_HEAD

if ! docker image inspect "$image" >/dev/null 2>&1; then
    printf 'Building QEMU Wasm toolchain image...\n'
    docker build --tag "$image" - < "$source_dir/Dockerfile"
fi

mkdir -p "$output_dir"
if ! git -C "$source_dir" archive \
    --format=tar --output="$archive" "$expected_commit"; then
    printf 'Unable to archive QEMU source at %s\n' "$expected_commit" >&2
    exit 1
fi

flags=(
    '-O3'
    '-Wno-error=unused-command-line-argument'
    '-Wno-unused-command-line-argument'
    '-matomics'
    '-mbulk-memory'
    '-DNDEBUG'
    '-DG_DISABLE_ASSERT'
    '-D_GNU_SOURCE'
    '-sASYNCIFY=1'
    '-pthread'
    '-sPROXY_TO_PTHREAD=1'
    '-sFORCE_FILESYSTEM'
    '-sALLOW_TABLE_GROWTH'
    '-sINITIAL_MEMORY=1024MB'
    '-sWASM_BIGINT'
    '-sMALLOC=mimalloc'
    '--js-library=/build/node_modules/xterm-pty/emscripten-pty.js'
    '--pre-js=/patch/websocket.js'
    '-sEXPORT_ES6=1'
    '-sASYNCIFY_IMPORTS=ffi_call_js'
)
printf -v qemu_flags '%s ' "${flags[@]}"
qemu_flags=${qemu_flags% }

# Docker Desktop invoked from Git Bash expects native Windows bind paths.
docker_path() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -w -- "$1"
    else
        printf '%s\n' "$1"
    fi
}

archive_mount=$(docker_path "$archive")
patch_mount=$(docker_path "$patch_dir")
output_mount=$(docker_path "$output_dir")

docker run --rm \
    --env "QEMU_FLAGS=$qemu_flags" \
    --mount "type=bind,source=$archive_mount,target=/source.tar,readonly" \
    --mount "type=bind,source=$patch_mount,target=/patch,readonly" \
    --mount "type=bind,source=$output_mount,target=/out" \
    "$image" bash -lc '
set -euo pipefail
mkdir /qemu
tar -C /qemu -xf /source.tar
cp /patch/ui/wasm.c /qemu/ui/wasm.c
cd /qemu
sed -i '\''s/\r$//'\'' configure qapi/ui.json ui/meson.build scripts/hxtool
find scripts -type f -name '\''*.sh'\'' -exec sed -i '\''s/\r$//'\'' {} +
patch -p1 < /patch/metadata.patch
mkdir -p /build/qemu-build
cd /build/qemu-build
emconfigure /qemu/configure --static --target-list=aarch64-softmmu --cpu=wasm32 --cross-prefix= --without-default-features --enable-system --enable-pixman --with-coroutine=fiber --extra-cflags="$QEMU_FLAGS" --extra-cxxflags="$QEMU_FLAGS" --extra-ldflags="-sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS"
if ! emmake make -j"$(nproc)" qemu-system-aarch64 > /tmp/qemu-build.log 2>&1; then
    tail -n 240 /tmp/qemu-build.log
    exit 1
fi
tail -n 20 /tmp/qemu-build.log
cp qemu-system-aarch64 /out/out.js
cp qemu-system-aarch64.wasm /out/qemu-system-aarch64.wasm
cp qemu-system-aarch64.worker.js /out/qemu-system-aarch64.worker.js
'

printf 'QEMU Wasm display build written to %s\n' "$output_dir"
