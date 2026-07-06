using System;
using System.Threading;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using OpenCvSharp;
using OpenCvSharp.WpfExtensions;
using ScreenRecorderApp.Interop;
using ScreenRecorderApp.Services;

namespace ScreenRecorderApp.Windows;

/// <summary>
/// Borderless, always-on-top, click-through window showing the live webcam clipped to a
/// circle. It sits on screen (bottom-right of the recorded display) and is captured by the
/// screen recording, which is how the camera ends up "rounded" in the video — ScreenRecorderLib
/// itself only supports rectangular overlays.
/// </summary>
public partial class WebcamOverlayWindow : Window
{
    private readonly int _cameraIndex;
    private CancellationTokenSource? _cts;
    private Thread? _captureThread;

    /// <summary>Raised (on the UI thread) if the camera cannot be opened or read.</summary>
    public event EventHandler<string>? Failed;

    public WebcamOverlayWindow(ScreenBounds screen, int cameraIndex, double diameter = 220, double margin = 40)
    {
        InitializeComponent();

        _cameraIndex = cameraIndex;

        Width = diameter;
        Height = diameter;
        Left = screen.Right - diameter - margin;
        Top = screen.Bottom - diameter - margin;
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var hwnd = new WindowInteropHelper(this).Handle;
        NativeMethods.MakeClickThrough(hwnd);
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _captureThread = new Thread(() => CaptureLoop(_cts.Token))
        {
            IsBackground = true,
            Name = "WebcamCapture"
        };
        _captureThread.Start();
    }

    private void CaptureLoop(CancellationToken token)
    {
        VideoCapture? capture = null;
        try
        {
            capture = new VideoCapture(_cameraIndex, VideoCaptureAPIs.DSHOW);
            if (!capture.IsOpened())
            {
                RaiseFailed("Impossible d'ouvrir la caméra sélectionnée.");
                return;
            }

            capture.Set(VideoCaptureProperties.FrameWidth, 640);
            capture.Set(VideoCaptureProperties.FrameHeight, 480);

            using var frame = new Mat();
            while (!token.IsCancellationRequested)
            {
                if (!capture.Read(frame) || frame.Empty())
                {
                    Thread.Sleep(15);
                    continue;
                }

                var bmp = frame.ToBitmapSource();
                bmp.Freeze();

                if (token.IsCancellationRequested)
                    break;

                Dispatcher.BeginInvoke(new Action(() => CameraBrush.ImageSource = bmp));
                Thread.Sleep(30); // ~30 fps preview
            }
        }
        catch (Exception ex)
        {
            RaiseFailed($"Erreur caméra : {ex.Message}");
        }
        finally
        {
            capture?.Dispose();
        }
    }

    private void RaiseFailed(string message)
    {
        Dispatcher.BeginInvoke(new Action(() => Failed?.Invoke(this, message)));
    }

    public void StopAndClose()
    {
        try
        {
            _cts?.Cancel();
            // The capture thread may block inside Read(); give it a moment, but don't hang the UI.
            _captureThread?.Join(TimeSpan.FromMilliseconds(500));
        }
        catch
        {
            // ignore
        }
        finally
        {
            _cts?.Dispose();
            _cts = null;
            Close();
        }
    }
}
