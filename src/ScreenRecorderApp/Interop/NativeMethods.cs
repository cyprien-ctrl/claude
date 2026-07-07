using System;
using System.Runtime.InteropServices;

namespace ScreenRecorderApp.Interop;

/// <summary>
/// Win32 / DWM P/Invoke helpers used for: hiding the taskbar, dark title bar,
/// global hotkeys, and making the webcam overlay window click-through.
/// </summary>
internal static class NativeMethods
{
    // ---- Window show/find (taskbar) ----
    public const int SW_HIDE = 0;
    public const int SW_SHOW = 5;

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string? className, string? windowTitle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    // ---- Extended window styles (click-through overlay) ----
    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_LAYERED = 0x00080000;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_NOACTIVATE = 0x08000000;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    // ---- Global hotkeys ----
    public const int WM_HOTKEY = 0x0312;
    public const uint MOD_ALT = 0x0001;
    public const uint MOD_CONTROL = 0x0002;
    public const uint MOD_SHIFT = 0x0004;
    public const uint MOD_NOREPEAT = 0x4000;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    // ---- Dark title bar (Windows 10 build 18985+ / Windows 11) ----
    public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

    [DllImport("dwmapi.dll", PreserveSig = true)]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    public static void TryEnableDarkTitleBar(IntPtr hwnd)
    {
        try
        {
            int useDark = 1;
            DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref useDark, sizeof(int));
        }
        catch
        {
            // Older Windows without the DWM attribute: ignore, keep the default title bar.
        }
    }

    public static void MakeClickThrough(IntPtr hwnd)
    {
        int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
        exStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        SetWindowLong(hwnd, GWL_EXSTYLE, exStyle);
    }

    /// <summary>Keep the window out of Alt+Tab but still clickable.</summary>
    public static void MakeToolWindow(IntPtr hwnd)
    {
        int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
        exStyle |= WS_EX_TOOLWINDOW;
        SetWindowLong(hwnd, GWL_EXSTYLE, exStyle);
    }

    // ---- Exclude a window from screen capture (Windows 10 2004+ / build 19041+) ----
    public const uint WDA_NONE = 0x00000000;
    public const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    /// <summary>
    /// Makes the window visible on screen but invisible to screen-capture APIs
    /// (Desktop Duplication, Graphics Capture) — used for the recording control bar so it
    /// doesn't appear in the video. No-op on older Windows where it isn't supported.
    /// </summary>
    public static void TryExcludeFromCapture(IntPtr hwnd)
    {
        try
        {
            SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        }
        catch
        {
            // Unsupported OS build: the bar will simply be visible in the recording.
        }
    }

    /// <summary>Undo <see cref="TryExcludeFromCapture"/> so the window is captured normally again.</summary>
    public static void TryIncludeInCapture(IntPtr hwnd)
    {
        try
        {
            SetWindowDisplayAffinity(hwnd, WDA_NONE);
        }
        catch
        {
            // ignore
        }
    }
}
