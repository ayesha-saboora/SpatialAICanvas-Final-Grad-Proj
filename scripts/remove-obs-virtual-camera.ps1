# Run in PowerShell as Administrator (right-click → Run as administrator)
# Removes leftover OBS Studio files and the OBS virtual camera device.

$ErrorActionPreference = 'Continue'

Write-Host 'Stopping OBS processes (if any)...' -ForegroundColor Cyan
Get-Process obs64, obs32, obs -ErrorAction SilentlyContinue | Stop-Process -Force

$vcamId = 'SWD\VCAMDEVAPI\D8F389289F3A8C4186B47A8206C61AEBADECCD87D542CE8907DE882E49C16EC0'
Write-Host 'Removing Windows virtual camera device...' -ForegroundColor Cyan
pnputil /remove-device $vcamId 2>$null

Write-Host 'Removing OBS Program Files folder...' -ForegroundColor Cyan
if (Test-Path 'C:\Program Files\obs-studio') {
  Remove-Item 'C:\Program Files\obs-studio' -Recurse -Force
}

Write-Host 'Removing OBS registry key...' -ForegroundColor Cyan
if (Test-Path 'HKLM:\SOFTWARE\OBS Studio') {
  Remove-Item 'HKLM:\SOFTWARE\OBS Studio' -Recurse -Force
}

$appData = Join-Path $env:APPDATA 'obs-studio'
$localAppData = Join-Path $env:LOCALAPPDATA 'obs-studio'
foreach ($dir in @($appData, $localAppData)) {
  if (Test-Path $dir) {
    Write-Host "Removing $dir ..." -ForegroundColor Cyan
    Remove-Item $dir -Recurse -Force
  }
}

Write-Host ''
Write-Host 'Done. Restart your browser completely, then Retry camera in the app.' -ForegroundColor Green
Write-Host 'Your built-in camera should appear as Integrated Camera.' -ForegroundColor Green
