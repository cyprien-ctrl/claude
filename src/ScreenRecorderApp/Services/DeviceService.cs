using System.Collections.Generic;
using System.Linq;
using ScreenRecorderLib;

namespace ScreenRecorderApp.Services;

public sealed record DeviceOption(string Id, string Label);

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
            options.Add(new DeviceOption(screen.DeviceName, label));
        }
        return options;
    }

    public static List<DeviceOption> GetWebcams()
    {
        return Recorder.GetSystemVideoCaptureDevices()
            .Select(c => new DeviceOption(c.DeviceName, string.IsNullOrWhiteSpace(c.FriendlyName) ? c.DeviceName : c.FriendlyName))
            .ToList();
    }

    public static List<DeviceOption> GetMicrophones()
    {
        return Recorder.GetSystemAudioDevices(AudioDeviceSource.InputDevices)
            .Select(a => new DeviceOption(a.DeviceName, string.IsNullOrWhiteSpace(a.FriendlyName) ? a.DeviceName : a.FriendlyName))
            .ToList();
    }
}
