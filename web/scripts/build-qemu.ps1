param(
    [Parameter(Mandatory = $true)]
    [string] $Source
)

$ErrorActionPreference = 'Stop'

$expectedCommit = '0ef7b4e2814b231705d8371dd7997f5b72e70baf'
$image = 'granite-qemu-wasm-build:0ef7b4e'
$root = Split-Path -Parent $PSScriptRoot
$patch = Join-Path $root 'qemu'
$output = Join-Path $root 'frontend\public\qemu\wasm'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$archive = Join-Path ([IO.Path]::GetTempPath()) "granite-qemu-$([Guid]::NewGuid()).tar"

$commit = git -c "safe.directory=$sourcePath" -C $sourcePath rev-parse HEAD

if ($commit -ne $expectedCommit) {
    throw "QEMU source must be at $expectedCommit; found $commit"
}

if (git -c "safe.directory=$sourcePath" -C $sourcePath status --porcelain) {
    throw 'QEMU source must be clean'
}

docker run --rm $image true

if ($LASTEXITCODE -ne 0) {
    throw "Required Docker image is unavailable: $image"
}

New-Item -ItemType Directory -Force -Path $output | Out-Null

git -c "safe.directory=$sourcePath" -C $sourcePath archive `
    --format=tar --output=$archive $expectedCommit

if ($LASTEXITCODE -ne 0) {
    throw "Unable to archive QEMU source at $expectedCommit"
}

$flags = @(
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
    '-sEXPORT_ES6=1'
    '-sASYNCIFY_IMPORTS=ffi_call_js'
) -join ' '

$command = @"
set -euo pipefail
mkdir /qemu
tar -C /qemu -xf /source.tar
cp /patch/ui/wasm.c /qemu/ui/wasm.c
cd /qemu
sed -i 's/\r`$//' configure qapi/ui.json ui/meson.build scripts/hxtool
find scripts -type f -name '*.sh' -exec sed -i 's/\r`$//' {} +
patch -p1 < /patch/metadata.patch
mkdir -p /build/qemu-build
cd /build/qemu-build
emconfigure /qemu/configure --static --target-list=aarch64-softmmu --cpu=wasm32 --cross-prefix= --without-default-features --enable-system --enable-pixman --with-coroutine=fiber --extra-cflags='$flags' --extra-cxxflags='$flags' --extra-ldflags='-sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS'
if ! emmake make -j`$(nproc) qemu-system-aarch64 > /tmp/qemu-build.log 2>&1; then
    tail -n 240 /tmp/qemu-build.log
    exit 1
fi
tail -n 20 /tmp/qemu-build.log
cp qemu-system-aarch64 /out/out.js
cp qemu-system-aarch64.wasm /out/qemu-system-aarch64.wasm
cp qemu-system-aarch64.worker.js /out/qemu-system-aarch64.worker.js
"@

$command = $command.Replace("`r`n", "`n")

try {

    docker run --rm `
        --mount "type=bind,source=$archive,target=/source.tar,readonly" `
        --mount "type=bind,source=$patch,target=/patch,readonly" `
        --mount "type=bind,source=$output,target=/out" `
        $image bash -lc $command

    $buildExitCode = $LASTEXITCODE

} finally {

    if (Test-Path -LiteralPath $archive) {
        Remove-Item -LiteralPath $archive -Force
    }

}

if ($buildExitCode -ne 0) {
    throw "QEMU build failed with exit code $buildExitCode"
}

Write-Host "QEMU Wasm display build written to $output"
