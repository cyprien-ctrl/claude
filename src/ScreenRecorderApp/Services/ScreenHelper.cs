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

/// <summary>A crop rectangle in pixels, expressed relative to a display's top-left corner.</summary>
public readonly record struct CropRect(int X, int Y, int Width, int Height);

public static class ScreenHelper
{
    /// <summary>Full bounds of the matching screen (or primary), in DIP.</summary>
    public static ScreenBounds GetBoundsForDevice(string? deviceName, Visual dpiSource)
        => ToDip(FindScreen(deviceName).Bounds, dpiSource);

    /// <summary>
    /// Work area (screen minus the taskbar) of the matching screen, in DIP. Used to place
    /// the webcam bubble and control bar clear of the taskbar.
    /// </summary>
    public static ScreenBounds GetWorkAreaForDevice(string? deviceName, Visual dpiSource)
        => ToDip(FindScreen(deviceName).WorkingArea, dpiSource);

    /// <summary>
    /// The recording crop (in pixels, relative to the display) that excludes the taskbar,
    /// or null if this screen has no reserved taskbar area (nothing to crop).
    /// </summary>
    public static CropRect? GetTaskbarCrop(string? deviceName)
    {
        var screen = FindScreen(deviceName);
        var b = screen.Bounds;
        var wa = screen.WorkingArea;
        if (wa == b)
            return null;
        return new CropRect(wa.X - b.X, wa.Y - b.Y, wa.Width, wa.Height);
    }

    private static ScreenBounds ToDip(System.Drawing.Rectangle r, Visual dpiSource)
    {
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

        return new ScreenBounds(r.Left / scaleX, r.Top / scaleY, r.Width / scaleX, r.Height / scaleY);
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
