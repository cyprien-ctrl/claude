using System.Collections.Generic;
using System.Linq;
using ScreenRecorderLib;

namespace ScreenRecorderApp.Services;

/// <summary>
/// A selectable device. <see cref="Index"/> is the enumeration ordinal, used to open
/// the webcam with OpenCV (which addresses cameras by index, not by name).
/// </summary>
public sealed record DeviceOption(string Id, string Label, int Index);

public static class DeviceService
{
    public static List<DeviceOption> GetScreens()
    {
        var screens = Recorder.GetDisplays();
        var options = new List<DeviceOption>();
        for (int i = 0; i < screens.Count; i++)
        {
            var screen = screens[i];
            var label = string.IsNullOrWhiteSpace(screen.FriendlyName)
                ? $"Écran {i + 1} ({screen.DeviceName})"
                : screen.FriendlyName;
            options.Add(new DeviceOption(screen.DeviceName, label, i));
        }
        return options;
    }

    public static List<DeviceOption> GetWebcams()
    {
        var cameras = Recorder.GetSystemVideoCaptureDevices();
        return cameras
            .Select((c, i) => new DeviceOption(
                c.DeviceName,
                string.IsNullOrWhiteSpace(c.FriendlyName) ? c.DeviceName : c.FriendlyName,
                i))
            .ToList();
    }

    public static List<DeviceOption> GetMicrophones()
    {
        return Recorder.GetSystemAudioDevices(AudioDeviceSource.InputDevices)
            .Select((a, i) => new DeviceOption(
                a.DeviceName,
                string.IsNullOrWhiteSpace(a.FriendlyName) ? a.DeviceName : a.FriendlyName,
                i))
            .ToList();
    }
}
