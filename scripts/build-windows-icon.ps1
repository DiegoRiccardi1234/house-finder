param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# One design at every scale. DIB frames also work with .NET Framework NotifyIcon/ToBitmap.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.ScaleTransform(($size / 64.0), ($size / 64.0))
    $green = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 74, 107, 82))
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $roof = New-Object System.Drawing.Drawing2D.GraphicsPath
    $stream = New-Object System.IO.MemoryStream
    try {
        $g.FillEllipse($green, 0, 0, 64, 64)
        $roof.AddPolygon(@((New-Object System.Drawing.Point 32, 14), (New-Object System.Drawing.Point 52, 32), (New-Object System.Drawing.Point 12, 32)))
        $g.FillPath($white, $roof)
        $g.FillRectangle($white, 20, 32, 24, 18)
        $g.FillRectangle($green, 28, 38, 8, 12)
        $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Bmp)
        $bytes = $stream.ToArray()
        $maskStride = [int]([Math]::Ceiling($size / 32.0) * 4)
        $dib = New-Object byte[] ($bytes.Length - 14 + $maskStride * $size)
        [Array]::Copy($bytes, 14, $dib, 0, $bytes.Length - 14)
        [BitConverter]::GetBytes([int]($size * 2)).CopyTo($dib, 8)
        # AND mask: fully transparent background pixels must stay transparent in old Shell paths.
        for ($y = 0; $y -lt $size; $y++) {
            for ($x = 0; $x -lt $size; $x++) {
                if ($bmp.GetPixel($x, $y).A -eq 0) {
                    $at = $bytes.Length - 14 + ($size - 1 - $y) * $maskStride + [int][Math]::Floor($x / 8.0)
                    $dib[$at] = $dib[$at] -bor (128 -shr ($x % 8))
                }
            }
        }
        $images += ,$dib
    } finally {
        $stream.Dispose(); $roof.Dispose(); $white.Dispose(); $green.Dispose(); $g.Dispose(); $bmp.Dispose()
    }
}
$file = [System.IO.File]::Create($Out)
$writer = New-Object System.IO.BinaryWriter $file
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
        $offset += $images[$i].Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image) }
} finally { $writer.Dispose(); $file.Dispose() }
