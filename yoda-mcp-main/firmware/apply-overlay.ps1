<#
  apply-overlay.ps1 — drop the Yoda firmware overlay onto a clean xiaozhi-esp32 checkout.

  Copies our board + audio assets into the upstream tree and applies our patches to the
  upstream files we modified. Idempotent-ish: copies overwrite; patches are skipped if
  already applied (git apply --check).

  Usage (run from anywhere):
    powershell -File apply-overlay.ps1 -XiaozhiRoot C:\path\to\xiaozhi-esp32
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$XiaozhiRoot
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$xz   = (Resolve-Path $XiaozhiRoot).Path

if (-not (Test-Path (Join-Path $xz "main\boards\common\esp32_camera.cc"))) {
    throw "[-] $xz doesn't look like an xiaozhi-esp32 checkout (main/boards/common/esp32_camera.cc not found)."
}

Write-Host "[*] Overlaying Yoda firmware onto $xz"

# 1. Drop-in: our board + audio assets
$boardDst = Join-Path $xz "main\boards\yoda-pendant"
New-Item -ItemType Directory -Force -Path $boardDst | Out-Null
Copy-Item (Join-Path $here "yoda-pendant\*") $boardDst -Force
Write-Host "    + main/boards/yoda-pendant/ (config.h, config.json, yoda_pendant_board.cc)"

$assetDst = Join-Path $xz "main\assets\common"
New-Item -ItemType Directory -Force -Path $assetDst | Out-Null
Copy-Item (Join-Path $here "assets\*.ogg") $assetDst -Force
Write-Host "    + main/assets/common/ (door.ogg, checking.ogg)"

# 2. Patches for the upstream files we touched
Push-Location $xz
try {
    Get-ChildItem (Join-Path $here "patches\*.patch") | ForEach-Object {
        $p = $_.FullName
        # already applied?  git apply -R --check succeeds  ->  skip
        & git apply -R --check $p 2>$null
        if ($?) { Write-Host "    = $($_.Name) already applied, skipping"; return }
        & git apply --check $p 2>$null
        if (-not $?) { throw "[-] $($_.Name) does not apply cleanly (upstream may have drifted)." }
        & git apply $p
        Write-Host "    + applied $($_.Name)"
    }
} finally {
    Pop-Location
}

Write-Host "[+] Overlay complete. Build with:  python scripts\release.py yoda-pendant"
