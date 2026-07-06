using System;
using System.Windows;
using System.Windows.Media;
using WinFormsScreen = System.Windows.Forms.Screen;

namespace ScreenRecorderApp.Services;

/// <summary>
/// Bounds of a physical monitor expressed in WPF device-independent units (DIP),
/// so overlay windows can be positioned on the correct screen.
/// </summary>
public readonly record struct ScreenBounds(double Left, double Top, double Width, double Height)
{
    public double Right => Left + Width;
    public double Bottom => Top + Height;
}

public static class ScreenHelper
{
    /// <summary>
    /// Resolves the bounds of the screen whose device name matches (e.g. "\\.\DISPLAY1").
    /// Falls back to the primary screen. Pixel bounds are converted to DIP using the
    /// DPI of the supplied visual (correct on single-DPI setups; approximate across
    /// mixed-DPI monitors).
    /// </summary>
    public static ScreenBounds GetBoundsForDevice(string? deviceName, Visual dpiSource)
    {
        var screen = FindScreen(deviceName);

        double scaleX = 1.0, scaleY = 1.0;
        try
        {
            var dpi = VisualTreeHelper.GetDpi(dpiSource);
            scaleX = dpi.DpiScaleX == 0 ? 1.0 : dpi.DpiScaleX;
            scaleY = dpi.DpiScaleY == 0 ? 1.0 : dpi.DpiScaleY;
        }
        catch
        {
            // Visual not yet connected to a presentation source: assume 100%.
        }

        var b = screen.Bounds;
        return new ScreenBounds(b.Left / scaleX, b.Top / scaleY, b.Width / scaleX, b.Height / scaleY);
    }

    private static WinFormsScreen FindScreen(string? deviceName)
    {
        if (!string.IsNullOrEmpty(deviceName))
        {
            foreach (var s in WinFormsScreen.AllScreens)
            {
                if (string.Equals(s.DeviceName, deviceName, StringComparison.OrdinalIgnoreCase))
                    return s;
            }
        }
        return WinFormsScreen.PrimaryScreen ?? WinFormsScreen.AllScreens[0];
    }
}
