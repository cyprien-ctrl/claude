using System;
using System.Collections.Generic;
using ScreenRecorderApp.Interop;

namespace ScreenRecorderApp.Services;

/// <summary>
/// Hides / restores the Windows taskbar (primary and any secondary taskbars on
/// multi-monitor setups) so it does not appear in the recording.
/// Always call <see cref="Show"/> to restore it, even on error.
/// </summary>
public static class TaskbarService
{
    private static bool _hidden;

    public static void Hide()
    {
        foreach (var handle in GetTaskbarHandles())
            NativeMethods.ShowWindow(handle, NativeMethods.SW_HIDE);
        _hidden = true;
    }

    public static void Show()
    {
        foreach (var handle in GetTaskbarHandles())
            NativeMethods.ShowWindow(handle, NativeMethods.SW_SHOW);
        _hidden = false;
    }

    /// <summary>Restore the taskbar only if we hid it. Safe to call multiple times.</summary>
    public static void RestoreIfHidden()
    {
        if (_hidden)
            Show();
    }

    private static IEnumerable<IntPtr> GetTaskbarHandles()
    {
        var handles = new List<IntPtr>();

        var primary = NativeMethods.FindWindow("Shell_TrayWnd", null);
        if (primary != IntPtr.Zero)
            handles.Add(primary);

        // Secondary taskbars (one per additional monitor).
        IntPtr secondary = IntPtr.Zero;
        while ((secondary = NativeMethods.FindWindowEx(IntPtr.Zero, secondary, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero)
            handles.Add(secondary);

        return handles;
    }
}
