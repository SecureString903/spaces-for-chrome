# Builds the Chrome Web Store upload zip into dist\spaces-v<version>.zip.
# Includes only what the extension needs at runtime — no dev files.

$root = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version

$distDir = Join-Path $root "dist"
$staging = Join-Path $distDir "staging"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null

Copy-Item (Join-Path $root "manifest.json") $staging
foreach ($dir in "background", "sidepanel", "options", "onboarding", "shared", "icons", "newtab") {
    Copy-Item (Join-Path $root $dir) $staging -Recurse
}
# page.css is shared by options/onboarding; sidepanel css is self-contained.

$zip = Join-Path $distDir "spaces-v$version.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path "$staging\*" -DestinationPath $zip
Remove-Item -Recurse -Force $staging

Write-Output "Packaged: $zip"
