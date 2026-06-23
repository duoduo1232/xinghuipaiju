Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $root 'public') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root 'src\assets') | Out-Null

function New-Canvas([int]$size, [bool]$transparent) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  if ($transparent) {
    $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
  } else {
    $g.Clear([System.Drawing.Color]::FromArgb(255, 28, 16, 52))
  }
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  return @($bmp, $g)
}

function Set-Block($bmp, [int]$x, [int]$y, [int]$w, [int]$h, [System.Drawing.Color]$c) {
  for ($iy = $y; $iy -lt ($y + $h); $iy++) {
    for ($ix = $x; $ix -lt ($x + $w); $ix++) {
      if ($ix -ge 0 -and $iy -ge 0 -and $ix -lt $bmp.Width -and $iy -lt $bmp.Height) {
        $bmp.SetPixel($ix, $iy, $c)
      }
    }
  }
}

function Set-Dots($bmp, $points, [System.Drawing.Color]$color) {
  foreach ($pt in $points) {
    $bmp.SetPixel([int]$pt[0], [int]$pt[1], $color)
  }
}

function Draw-Icon($bmp, [bool]$transparent) {
  $bg = [System.Drawing.Color]::FromArgb(255, 28, 16, 52)
  $shadow = [System.Drawing.Color]::FromArgb(150, 8, 6, 16)
  $goldDark = [System.Drawing.Color]::FromArgb(255, 147, 102, 32)
  $gold = [System.Drawing.Color]::FromArgb(255, 239, 190, 74)
  $goldLight = [System.Drawing.Color]::FromArgb(255, 255, 228, 120)
  $inner = [System.Drawing.Color]::FromArgb(255, 28, 18, 49)
  $teal = [System.Drawing.Color]::FromArgb(255, 76, 232, 230)
  $cyan = [System.Drawing.Color]::FromArgb(255, 160, 255, 249)
  $red = [System.Drawing.Color]::FromArgb(255, 247, 88, 98)
  $spark = [System.Drawing.Color]::FromArgb(255, 255, 244, 176)

  if (-not $transparent) {
    Set-Block $bmp 0 0 64 64 $bg
    Set-Block $bmp 4 5 56 56 $shadow
    Set-Block $bmp 8 8 48 48 ([System.Drawing.Color]::FromArgb(255, 37, 21, 69))
  }

  Set-Block $bmp 16 13 32 38 $goldDark
  Set-Block $bmp 17 14 30 36 $gold
  Set-Block $bmp 18 15 28 34 $goldLight
  Set-Block $bmp 20 17 24 30 $inner
  Set-Dots $bmp @(
    @(18,16), @(19,16), @(44,16), @(45,16),
    @(17,17), @(46,17), @(17,46), @(46,46),
    @(18,47), @(19,47), @(44,47), @(45,47)
  ) $goldLight

  Set-Block $bmp 22 20 4 2 $cyan
  Set-Block $bmp 22 23 6 1 $red
  Set-Block $bmp 22 25 5 1 $teal

  Set-Dots $bmp @(
    @(32,24), @(31,25), @(33,25), @(30,26), @(34,26), @(29,27), @(35,27),
    @(28,28), @(36,28), @(27,29), @(37,29), @(26,30), @(38,30),
    @(24,31), @(25,31), @(26,31), @(27,31), @(28,31), @(29,31), @(30,31), @(31,31), @(32,31), @(33,31), @(34,31), @(35,31), @(36,31), @(37,31), @(38,31),
    @(27,32), @(37,32), @(28,33), @(36,33), @(29,34), @(35,34), @(30,35), @(34,35), @(31,36), @(33,36), @(32,37)
  ) $cyan
  Set-Dots $bmp @(
    @(32,26), @(31,27), @(33,27), @(30,28), @(34,28), @(29,29), @(35,29), @(28,30), @(36,30), @(27,31), @(37,31),
    @(28,32), @(36,32), @(29,33), @(35,33), @(30,34), @(34,34), @(31,35), @(33,35)
  ) $red
  Set-Dots $bmp @(
    @(32,25), @(30,27), @(34,27), @(29,30), @(35,30), @(29,32), @(35,32), @(30,35), @(34,35), @(32,38)
  ) $spark

  Set-Dots $bmp @(
    @(21,22), @(43,22), @(19,28), @(45,28), @(20,40), @(44,40), @(24,42), @(40,42)
  ) $teal
  Set-Dots $bmp @(
    @(14,18), @(49,19), @(13,44), @(50,43), @(31,11), @(33,11)
  ) $spark
  Set-Dots $bmp @(
    @(13,20), @(15,18), @(50,21), @(48,19), @(12,43), @(14,45), @(51,42), @(49,44)
  ) $red
  Set-Block $bmp 23 39 7 2 $goldLight
  Set-Block $bmp 24 42 10 1 $gold
}

function Save-Icon([string]$path, [int]$size, [bool]$transparent) {
  $pair = New-Canvas 64 $transparent
  $bmp = $pair[0]
  $g = $pair[1]
  try {
    Draw-Icon $bmp $transparent
    $out = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $og = [System.Drawing.Graphics]::FromImage($out)
    try {
      $og.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
      $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
      $og.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $og.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
      $og.DrawImage($bmp, 0, 0, $size, $size)
      $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $og.Dispose()
      $out.Dispose()
    }
  } finally {
    $g.Dispose()
    $bmp.Dispose()
  }
}

Save-Icon (Join-Path $root 'src\assets\app-icon.png') 1024 $false
Save-Icon (Join-Path $root 'src\assets\app-icon-foreground.png') 1024 $true
Save-Icon (Join-Path $root 'public\favicon.png') 512 $false

$sizes = @{
  'mipmap-mdpi' = 48
  'mipmap-hdpi' = 72
  'mipmap-xhdpi' = 96
  'mipmap-xxhdpi' = 144
  'mipmap-xxxhdpi' = 192
}
$fgSizes = @{
  'mipmap-mdpi' = 108
  'mipmap-hdpi' = 162
  'mipmap-xhdpi' = 216
  'mipmap-xxhdpi' = 324
  'mipmap-xxxhdpi' = 432
}

foreach ($dir in $sizes.Keys) {
  Save-Icon (Join-Path $root "android\app\src\main\res\$dir\ic_launcher.png") $sizes[$dir] $false
  Save-Icon (Join-Path $root "android\app\src\main\res\$dir\ic_launcher_round.png") $sizes[$dir] $false
  Save-Icon (Join-Path $root "android\app\src\main\res\$dir\ic_launcher_foreground.png") $fgSizes[$dir] $true
}

Set-Content -NoNewline -Encoding utf8 (Join-Path $root 'android\app\src\main\res\values\ic_launcher_background.xml') @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#1C1034</color>
</resources>
'@

Set-Content -NoNewline -Encoding utf8 (Join-Path $root 'android\app\src\main\res\drawable\ic_launcher_background.xml') @'
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#1C1034"
        android:pathData="M0,0h108v108h-108z" />
</vector>
'@

Write-Host "Generated app icon assets."
