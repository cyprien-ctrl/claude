using System;
using System.Collections.Generic;
using System.IO;
using ScreenRecorderLib;

namespace ScreenRecorderApp.Services;

public sealed class RecordingSettings
{
    public required string ScreenDeviceName { get; init; }
    public bool IncludeWebcam { get; init; }
    public string? WebcamDeviceName { get; init; }
    public bool IncludeMicrophone { get; init; }
    public string? MicrophoneDeviceName { get; init; }
    public required string OutputFolder { get; init; }

    public static string DefaultOutputFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "ScreenRecorderApp");
}

public sealed class RecordingCompletedEventArgs(string filePath) : EventArgs
{
    public string FilePath { get; } = filePath;
}

// Named differently from ScreenRecorderLib's own RecordingFailedEventArgs to avoid the two
// types colliding under the `using ScreenRecorderLib;` import in this file.
public sealed class RecordingErrorEventArgs(string error) : EventArgs
{
    public string Error { get; } = error;
}

/// <summary>
/// Wraps ScreenRecorderLib's Recorder. "Restart" has no dedicated API in the library,
/// so it is implemented as stop -> discard the finished file -> start a new recording
/// with the same settings.
/// </summary>
public sealed class RecordingService : IDisposable
{
    private Recorder? _recorder;
    private RecordingSettings? _activeSettings;
    private bool _isRestarting;

    public bool IsRecording { get; private set; }

    public event EventHandler? RecordingStarted;
    public event EventHandler<RecordingCompletedEventArgs>? RecordingCompleted;
    public event EventHandler<RecordingErrorEventArgs>? RecordingFailed;

    public void Start(RecordingSettings settings)
    {
        if (IsRecording)
            throw new InvalidOperationException("Un enregistrement est déjà en cours.");

        Directory.CreateDirectory(settings.OutputFolder);

        _activeSettings = settings;
        var outputPath = Path.Combine(settings.OutputFolder, $"Enregistrement_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.mp4");

        _recorder = Recorder.CreateRecorder(BuildOptions(settings));
        _recorder.OnRecordingComplete += OnRecordingComplete;
        _recorder.OnRecordingFailed += OnRecordingFailed;

        _recorder.Record(outputPath);
        IsRecording = true;
        RecordingStarted?.Invoke(this, EventArgs.Empty);
    }

    public void Stop()
    {
        _recorder?.Stop();
    }

    /// <summary>
    /// Discards the current recording (no file is kept) and immediately starts a new one
    /// with the same settings.
    /// </summary>
    public void Restart()
    {
        if (!IsRecording || _recorder is null)
            return;

        _isRestarting = true;
        _recorder.Stop();
    }

    private void OnRecordingComplete(object? sender, RecordingCompleteEventArgs e)
    {
        IsRecording = false;
        DetachAndDispose();

        if (_isRestarting && _activeSettings is not null)
        {
            _isRestarting = false;
            DeleteFileQuietly(e.FilePath);
            Start(_activeSettings);
            return;
        }

        RecordingCompleted?.Invoke(this, new RecordingCompletedEventArgs(e.FilePath));
    }

    private void OnRecordingFailed(object? sender, RecordingFailedEventArgs e)
    {
        IsRecording = false;
        _isRestarting = false;
        DetachAndDispose();
        RecordingFailed?.Invoke(this, new RecordingErrorEventArgs(e.Error));
    }

    private void DetachAndDispose()
    {
        if (_recorder is null)
            return;

        _recorder.OnRecordingComplete -= OnRecordingComplete;
        _recorder.OnRecordingFailed -= OnRecordingFailed;
        _recorder.Dispose();
        _recorder = null;
    }

    private static void DeleteFileQuietly(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private static RecorderOptions BuildOptions(RecordingSettings settings)
    {
        var overlays = new List<RecordingOverlayBase>();
        if (settings.IncludeWebcam && !string.IsNullOrEmpty(settings.WebcamDeviceName))
        {
            overlays.Add(new VideoCaptureOverlay(settings.WebcamDeviceName)
            {
                AnchorPoint = Anchor.BottomRight,
                Offset = new ScreenSize(24, 24),
                Size = new ScreenSize(320, 240)
            });
        }

        return new RecorderOptions
        {
            SourceOptions = new SourceOptions
            {
                RecordingSources = new List<RecordingSourceBase>
                {
                    new DisplayRecordingSource(settings.ScreenDeviceName)
                }
            },
            OverlayOptions = new OverLayOptions
            {
                Overlays = overlays
            },
            OutputOptions = new OutputOptions
            {
                RecorderMode = RecorderMode.Video
            },
            AudioOptions = new AudioOptions
            {
                IsAudioEnabled = settings.IncludeMicrophone,
                IsInputDeviceEnabled = settings.IncludeMicrophone,
                IsOutputDeviceEnabled = false,
                AudioInputDevice = settings.MicrophoneDeviceName
            },
            MouseOptions = new MouseOptions
            {
                IsMousePointerEnabled = true
            },
            VideoEncoderOptions = new VideoEncoderOptions
            {
                Bitrate = 8_000_000,
                Framerate = 30,
                IsFixedFramerate = true,
                Encoder = new H264VideoEncoder
                {
                    BitrateMode = H264BitrateControlMode.Quality,
                    EncoderProfile = H264Profile.High
                }
            }
        };
    }

    public void Dispose()
    {
        DetachAndDispose();
    }
}
