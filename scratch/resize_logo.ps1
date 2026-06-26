Add-Type -AssemblyName System.Drawing

$originalPath = "e:\POEMAS\src\logo.jpg"
$resizedPath = "e:\POEMAS\src\logo_resized.jpg"

if (Test-Path $originalPath) {
    Write-Host "Loading original image..."
    $src = [System.Drawing.Image]::FromFile($originalPath)
    
    $newWidth = 384
    $newHeight = [int]($src.Height * ($newWidth / $src.Width))
    Write-Host "Original dimensions: $($src.Width)x$($src.Height)"
    Write-Host "New dimensions: $($newWidth)x$($newHeight)"
    
    $bmp = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
    $graph = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Set high quality resize settings
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graph.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    
    # Draw original image resized
    $graph.DrawImage($src, 0, 0, $newWidth, $newHeight)
    
    # Dispose original and graphics to release locks
    $src.Dispose()
    $graph.Dispose()
    
    # Save the resized image with 50% quality compression
    $encoder = [System.Drawing.Imaging.Encoder]::Quality
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($encoder, 50)
    
    $codecs = [System.Drawing.Imaging.ImageCodecInfo]::GetImageDecoders()
    $jpegCodec = $codecs | Where-Object { $_.FormatDescription -eq "JPEG" }
    
    $bmp.Save($resizedPath, $jpegCodec, $encoderParams)
    $bmp.Dispose()
    
    Write-Host "Resized image saved successfully to $resizedPath"
    
    $origSize = (Get-Item $originalPath).Length / 1024
    $newSize = (Get-Item $resizedPath).Length / 1024
    Write-Host "Original size: $('{0:N2}' -f $origSize) KB"
    Write-Host "New size: $('{0:N2}' -f $newSize) KB"
} else {
    Write-Error "Original logo not found at $originalPath"
}
