# Generates the extension icon set (16/32/48/128 px PNGs) into ../icons.
# Design: indigo rounded square with a 2x2 grid of tiles — one highlighted,
# representing the active Space among several.

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

# Draw the master at 128px
$size = 128
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$bg = [System.Drawing.Color]::FromArgb(255, 79, 70, 229)     # indigo-600
$tile = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)  # white
$hl = [System.Drawing.Color]::FromArgb(255, 165, 180, 252)    # indigo-300

$bgBrush = New-Object System.Drawing.SolidBrush($bg)
$tileBrush = New-Object System.Drawing.SolidBrush($tile)
$hlBrush = New-Object System.Drawing.SolidBrush($hl)

$bgPath = New-RoundedRectPath 4 4 120 120 28
$g.FillPath($bgBrush, $bgPath)

$tileSize = 34
$radius = 9
$positions = @(
    @(27, 27, $tileBrush),
    @(67, 27, $tileBrush),
    @(27, 67, $tileBrush),
    @(67, 67, $hlBrush)
)
foreach ($p in $positions) {
    $path = New-RoundedRectPath $p[0] $p[1] $tileSize $tileSize $radius
    $g.FillPath($p[2], $path)
    $path.Dispose()
}

$g.Dispose()
$bmp.Save((Join-Path $outDir "icon128.png"), [System.Drawing.Imaging.ImageFormat]::Png)

foreach ($s in 48, 32, 16) {
    $small = New-Object System.Drawing.Bitmap($s, $s)
    $sg = [System.Drawing.Graphics]::FromImage($small)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $sg.DrawImage($bmp, 0, 0, $s, $s)
    $sg.Dispose()
    $small.Save((Join-Path $outDir "icon$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $small.Dispose()
}

$bmp.Dispose()
Write-Output "Icons written to $outDir"
