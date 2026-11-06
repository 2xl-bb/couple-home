Add-Type -AssemblyName System.Drawing

function New-CoupleHomeIcon([int]$Size, [string]$Path) {
  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#fbf4ed'))

  $scale = $Size / 512.0
  $wall = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#dba8a4'))
  $accent = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#8f4a5b'))
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#8f4a5b'), 24 * $scale)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $house = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(112 * $scale, 243 * $scale),
    [System.Drawing.PointF]::new(256 * $scale, 120 * $scale),
    [System.Drawing.PointF]::new(400 * $scale, 243 * $scale),
    [System.Drawing.PointF]::new(400 * $scale, 410 * $scale),
    [System.Drawing.PointF]::new(112 * $scale, 410 * $scale)
  )
  $graphics.FillPolygon($wall, $house)
  $graphics.DrawPolygon($pen, $house)

  $heart = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $heart.StartFigure()
  $heart.AddBezier(256*$scale,371*$scale,235*$scale,346*$scale,189*$scale,319*$scale,189*$scale,278*$scale)
  $heart.AddBezier(189*$scale,278*$scale,189*$scale,233*$scale,245*$scale,219*$scale,256*$scale,254*$scale)
  $heart.AddBezier(256*$scale,254*$scale,267*$scale,219*$scale,323*$scale,233*$scale,323*$scale,278*$scale)
  $heart.AddBezier(323*$scale,278*$scale,323*$scale,319*$scale,277*$scale,346*$scale,256*$scale,371*$scale)
  $heart.CloseFigure()
  $graphics.FillPath($accent, $heart)

  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $heart.Dispose(); $pen.Dispose(); $accent.Dispose(); $wall.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

New-CoupleHomeIcon 192 (Join-Path $PSScriptRoot '..\public\icon-192.png')
New-CoupleHomeIcon 512 (Join-Path $PSScriptRoot '..\public\icon-512.png')
