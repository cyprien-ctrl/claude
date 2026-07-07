using System;
using System.Collections.Generic;
using System.IO;
using System.Windows.Threading;
using ScreenRecorderLib;

namespace ScreenRecorderApp.Services;

public sealed class RecordingSettings
{
    public required string ScreenDeviceName { get; init; }
    public bool IncludeMicrophone { get; init; }
    public string? MicrophoneDeviceName { get; init; }
    public required string OutputFolder { get; init; }

    /// <summary>Optional crop (pixels, display-relative) to exclude the taskbar from the video.</summary>
    public CropRect? Crop { get; init; }

    public static string DefaultOutputFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "ScreenRecorder");
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
/// Wraps ScreenRecorderLib's Recorder for the screen + microphone tracks. The webcam is
/// rendered by a separate on-screen window (see WebcamOverlayWindow) so it can be circular;
/// it is captured naturally by the display recording.
///
/// "Restart" has no dedicated API in the library, so it is stop -> discard the finished
/// file -> start a new recording with the same settings.
/// </summary>
public sealed class RecordingService : IDisposable
{
    // Captured on the UI thread at construction; used to marshal ScreenRecorderLib's
    // native callbacks OFF their internal thread before touching/disposing the recorder.
    private readonly Dispatcher _dispatcher;
    private Recorder? _recorder;
    private RecordingSettings? _activeSettings;
    private bool _isRestarting;

    public bool IsRecording { get; private set; }
    public bool IsPaused { get; private set; }

    public event EventHandler? RecordingStarted;
    public event EventHandler<RecordingCompletedEventArgs>? RecordingCompleted;
    public event EventHandler<RecordingErrorEventArgs>? RecordingFailed;

    public RecordingService()
    {
        _dispatcher = Dispatcher.CurrentDispatcher;
    }

    public void Start(RecordingSettings settings)
    {
        if (IsRecording)
            throw new InvalidOperationException("Un enregistrement est déjà en cours.");

        Directory.CreateDirectory(settings.OutputFolder);

        _activeSettings = settings;
        var outputPath = Path.Combine(settings.OutputFolder, $"Enregistrement_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.mp4");

        DisposeRecorder(); // release any previous instance (safe: not on a callback thread here)

        _recorder = Recorder.CreateRecorder(BuildOptions(settings));
        _recorder.OnRecordingComplete += OnRecordingComplete;
        _recorder.OnRecordingFailed += OnRecordingFailed;

        _recorder.Record(outputPath);
        IsRecording = true;
        IsPaused = false;
        RecordingStarted?.Invoke(this, EventArgs.Empty);
    }

    public void Stop()
    {
        // Resuming first ensures the recorder finalizes cleanly if it was paused.
        if (IsPaused)
        {
            _recorder?.Resume();
            IsPaused = false;
        }
        _recorder?.Stop();
    }

    public void Pause()
    {
        if (IsRecording && !IsPaused)
        {
            _recorder?.Pause();
            IsPaused = true;
        }
    }

    public void Resume()
    {
        if (IsRecording && IsPaused)
        {
            _recorder?.Resume();
            IsPaused = false;
        }
    }

    /// <summary>
    /// Discards the current recording (no file is kept) and immediately starts a new one
    /// with the same settings.
    /// </summary>
    public void Restart()
    {
        if (!IsRecording || _recorder is null)
            return;

        if (IsPaused)
        {
            _recorder.Resume();
            IsPaused = false;
        }

        _isRestarting = true;
        _recorder.Stop();
    }

    // These fire on ScreenRecorderLib's internal thread. We must NOT dispose the recorder
    // here (Dispose would wait for this very thread and deadlock), so we hop off it first.
    private void OnRecordingComplete(object? sender, RecordingCompleteEventArgs e)
    {
        var path = e.FilePath;
        _dispatcher.BeginInvoke(new Action(() => HandleComplete(path)));
    }

    private void OnRecordingFailed(object? sender, RecordingFailedEventArgs e)
    {
        var error = e.Error;
        _dispatcher.BeginInvoke(new Action(() => HandleFailed(error)));
    }

    private void HandleComplete(string path)
    {
        IsRecording = false;
        IsPaused = false;
        DisposeRecorder(); // safe now: the callback thread has already returned

        if (_isRestarting && _activeSettings is not null)
        {
            _isRestarting = false;
            DeleteFileQuietly(path);
            Start(_activeSettings);
            return;
        }

        RecordingCompleted?.Invoke(this, new RecordingCompletedEventArgs(path));
    }

    private void HandleFailed(string error)
    {
        IsRecording = false;
        IsPaused = false;
        _isRestarting = false;
        DisposeRecorder();
        RecordingFailed?.Invoke(this, new RecordingErrorEventArgs(error));
    }

    private void DisposeRecorder()
    {
        if (_recorder is null)
            return;

        _recorder.OnRecordingComplete -= OnRecordingComplete;
        _recorder.OnRecordingFailed -= OnRecordingFailed;
        try { _recorder.Dispose(); } catch { /* best effort */ }
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
        var display = new DisplayRecordingSource(settings.ScreenDeviceName);
        if (settings.Crop is { } crop)
        {
            // Record only the work area so the taskbar (visible on screen) stays out of the video.
            display.SourceRect = new ScreenRect(crop.X, crop.Y, crop.Width, crop.Height);
        }

        return new RecorderOptions
        {
            SourceOptions = new SourceOptions
            {
                RecordingSources = new List<RecordingSourceBase> { display }
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
        DisposeRecorder();
    }
}
