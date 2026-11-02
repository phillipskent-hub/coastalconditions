# Generates the app icons in /icons with Windows' built-in System.Drawing (no dependencies).
#   powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
# Design: sun rising over two waves on the template's sea gradient.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $out | Out-Null

function Hex($h, $a = 255) {
  [System.Drawing.Color]::FromArgb($a, [Convert]::ToInt32($h.Substring(1, 2), 16),
    [Convert]::ToInt32($h.Substring(3, 2), 16), [Convert]::ToInt32($h.Substring(5, 2), 16))
}

# $rounded: transparent rounded corners (for "any" icons). $scale: shrink artwork into the
# maskable safe zone (Android crops maskable icons to a circle or squircle).
function Draw-Icon($size, $file, $rounded, $scale) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $size, $size), (Hex '#12304d'), (Hex '#3f8f9e')
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
  $blend.Colors = @((Hex '#12304d'), (Hex '#1f5a7a'), (Hex '#3f8f9e'))
  $blend.Positions = @(0.0, 0.55, 1.0)
  $bg.InterpolationColors = $blend

  if ($rounded) {
    $r = $size * 0.22
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
    $p.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
    $p.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $p.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $p.CloseFigure()
    $g.FillPath($bg, $p)
    $g.SetClip($p)
  } else {
    $g.FillRectangle($bg, 0, 0, $size, $size)
  }

  # Artwork in unit coordinates (0..1), scaled about the center.
  $X = { param($u) $size * (0.5 + ($u - 0.5) * $scale) }

  # Sun
  $cx = & $X 0.5; $cy = & $X 0.44; $rad = $size * 0.17 * $scale
  $g.FillEllipse((New-Object System.Drawing.SolidBrush (Hex '#e9b97a')), $cx - $rad, $cy - $rad, 2 * $rad, 2 * $rad)

  # Sea below the first wave hides the sun's lower half (sunrise over the water).
  $sea = New-Object System.Drawing.Drawing2D.GraphicsPath
  $sea.AddBezier((& $X 0.0), (& $X 0.6), (& $X 0.25), (& $X 0.52), (& $X 0.45), (& $X 0.68), (& $X 0.62), (& $X 0.6))
  $sea.AddBezier((& $X 0.62), (& $X 0.6), (& $X 0.78), (& $X 0.52), (& $X 0.9), (& $X 0.62), (& $X 1.0), (& $X 0.58))
  # Run the water out to the real edges (the artwork may be scaled into the safe zone).
  $sea.AddLine((& $X 1.0), (& $X 0.58), $size, (& $X 0.58))
  $sea.AddLine($size, (& $X 0.58), $size, $size)
  $sea.AddLine($size, $size, 0, $size)
  $sea.AddLine(0, $size, 0, (& $X 0.6))
  $sea.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush (Hex '#1f5a7a')), $sea)

  # Two wave lines
  foreach ($w in @(@{ y = 0.0; a = 255 }, @{ y = 0.14; a = 150 })) {
    $pen = New-Object System.Drawing.Pen (Hex '#f6f1e7' $w.a), ($size * 0.045 * $scale)
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $dy = $w.y
    # One path per wave, so the translucent one isn't painted twice where its halves meet.
    $wave = New-Object System.Drawing.Drawing2D.GraphicsPath
    $wave.AddBezier((& $X 0.14), (& $X (0.62 + $dy)), (& $X 0.28), (& $X (0.54 + $dy)), (& $X 0.4), (& $X (0.7 + $dy)), (& $X 0.54), (& $X (0.62 + $dy)))
    $wave.AddBezier((& $X 0.54), (& $X (0.62 + $dy)), (& $X 0.68), (& $X (0.54 + $dy)), (& $X 0.78), (& $X (0.7 + $dy)), (& $X 0.88), (& $X (0.62 + $dy)))
    $g.DrawPath($pen, $wave)
  }

  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Draw-Icon 512 'icon-512.png' $true 1.0
Draw-Icon 192 'icon-192.png' $true 1.0
Draw-Icon 512 'icon-maskable-512.png' $false 0.78
Draw-Icon 180 'apple-touch-icon.png' $false 1.0   # iOS rounds the corners itself
Draw-Icon 32 'favicon-32.png' $true 1.0
Get-ChildItem $out | Select-Object Name, Length
