param(
  [string]$OutputDirectory = "D:\workspace\MMD project\artifacts",
  [string]$BaseName = "desktop-pet-qa-current-cdp"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Add-Type -AssemblyName System.Drawing

$systemDrawingAssembly = Join-Path $env:WINDIR "Microsoft.NET\assembly\GAC_MSIL\System.Drawing\v4.0_4.0.0.0__b03f5f7f11d50a3a\System.Drawing.dll"
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class NotificationQaCapture {
  public const int SM_XVIRTUALSCREEN = 76;
  public const int SM_YVIRTUALSCREEN = 77;
  public const int SM_CXVIRTUALSCREEN = 78;
  public const int SM_CYVIRTUALSCREEN = 79;

  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int index);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  public static extern uint GetDpiForWindow(IntPtr hWnd);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  public static Bitmap CaptureVirtualScreen(out int left, out int top) {
    left = GetSystemMetrics(SM_XVIRTUALSCREEN);
    top = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
    using (var graphics = Graphics.FromImage(bitmap)) {
      graphics.CopyFromScreen(left, top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
    }
    return bitmap;
  }

  public static bool SaveCrop(
    Bitmap source,
    int screenLeft,
    int screenTop,
    RECT rect,
    string path,
    int padding
  ) {
    int left = Math.Max(screenLeft, rect.Left - padding);
    int top = Math.Max(screenTop, rect.Top - padding);
    int right = Math.Min(screenLeft + source.Width, rect.Right + padding);
    int bottom = Math.Min(screenTop + source.Height, rect.Bottom + padding);
    if (right <= left || bottom <= top) return false;
    var crop = new Rectangle(left - screenLeft, top - screenTop, right - left, bottom - top);
    using (var output = source.Clone(crop, PixelFormat.Format32bppArgb)) {
      output.Save(path, ImageFormat.Png);
    }
    return true;
  }
}
"@ -ReferencedAssemblies $systemDrawingAssembly

$windows = New-Object System.Collections.Generic.List[object]
[NotificationQaCapture]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [NotificationQaCapture]::IsWindowVisible($hWnd)) { return $true }
  $titleBuffer = New-Object System.Text.StringBuilder 512
  [NotificationQaCapture]::GetWindowText($hWnd, $titleBuffer, 512) | Out-Null
  $title = $titleBuffer.ToString()
  if ($title -notmatch "Codex task completed|MMD Codex Pet") { return $true }
  $rect = New-Object NotificationQaCapture+RECT
  [NotificationQaCapture]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
  $processId = [uint32]0
  [NotificationQaCapture]::GetWindowThreadProcessId($hWnd, [ref]$processId) | Out-Null
  $windows.Add([pscustomobject]@{
    HWND = ("0x{0:X}" -f $hWnd.ToInt64())
    Title = $title
    Pid = $processId
    Left = $rect.Left
    Top = $rect.Top
    Right = $rect.Right
    Bottom = $rect.Bottom
    Width = $rect.Right - $rect.Left
    Height = $rect.Bottom - $rect.Top
    Dpi = [NotificationQaCapture]::GetDpiForWindow($hWnd)
    Rect = $rect
  }) | Out-Null
  return $true
}, [IntPtr]::Zero) | Out-Null

$screenLeft = 0
$screenTop = 0
$screen = [NotificationQaCapture]::CaptureVirtualScreen([ref]$screenLeft, [ref]$screenTop)
$fullPath = Join-Path $OutputDirectory "$BaseName-full.png"
$screen.Save($fullPath, [System.Drawing.Imaging.ImageFormat]::Png)

foreach ($window in $windows) {
  $safeTitle = if ($window.Title -eq "Codex task completed") { "notice" } else { "pet" }
  $cropPath = Join-Path $OutputDirectory "$BaseName-$safeTitle.png"
  [NotificationQaCapture]::SaveCrop($screen, $screenLeft, $screenTop, $window.Rect, $cropPath, 18) | Out-Null
}

$metadata = [pscustomobject]@{
  capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  virtualScreen = @{
    left = $screenLeft
    top = $screenTop
    width = $screen.Width
    height = $screen.Height
  }
  windows = @($windows | ForEach-Object {
    [pscustomobject]@{
      hwnd = $_.HWND
      title = $_.Title
      pid = $_.Pid
      left = $_.Left
      top = $_.Top
      right = $_.Right
      bottom = $_.Bottom
      width = $_.Width
      height = $_.Height
      dpi = $_.Dpi
    }
  })
  files = @{
    full = $fullPath
    notice = Join-Path $OutputDirectory "$BaseName-notice.png"
    pet = Join-Path $OutputDirectory "$BaseName-pet.png"
  }
}
$metadataPath = Join-Path $OutputDirectory "$BaseName-metadata.json"
$metadata | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $metadataPath -Encoding UTF8

$screen.Dispose()
$metadata | ConvertTo-Json -Depth 6
