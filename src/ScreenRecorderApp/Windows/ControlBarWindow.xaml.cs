using System;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using ScreenRecorderApp.Interop;
using ScreenRecorderApp.Services;

namespace ScreenRecorderApp.Windows;

/// <summary>
/// Loom-style floating control bar, docked bottom-left of the recorded screen. It stays on
/// screen during recording but is excluded from the capture (WDA_EXCLUDEFROMCAPTURE), so it
/// never appears in the video. Exposes stop / restart / pause-resume as events.
/// </summary>
public partial class ControlBarWindow : Window
{
    private readonly ScreenBounds _screen;
    private readonly double _margin;

    public event EventHandler? StopRequested;
    public event EventHandler? RestartRequested;
    public event EventHandler? PauseResumeRequested;

    public ControlBarWindow(ScreenBounds screen, double margin = 24)
    {
        InitializeComponent();
        _screen = screen;
        _margin = margin;

        Loaded += (_, _) =>
        {
            Left = _screen.Left + _margin;
            Top = _screen.Bottom - ActualHeight - _margin;
        };
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var hwnd = new WindowInteropHelper(this).Handle;
        NativeMethods.MakeToolWindow(hwnd);
        NativeMethods.TryExcludeFromCapture(hwnd);
    }

    public void SetElapsed(string text) => TimerText.Text = text;

    public void SetPaused(bool paused)
    {
        PauseButton.Content = paused ? "▶" : "⏸";
        RecordingDot.Fill = paused ? Brushes.Orange : Brushes.Red;
    }

    private void RootBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left)
        {
            try { DragMove(); } catch { /* only valid while the left button is down */ }
        }
    }

    private void StopButton_Click(object sender, RoutedEventArgs e) => StopRequested?.Invoke(this, EventArgs.Empty);
    private void RestartButton_Click(object sender, RoutedEventArgs e) => RestartRequested?.Invoke(this, EventArgs.Empty);
    private void PauseButton_Click(object sender, RoutedEventArgs e) => PauseResumeRequested?.Invoke(this, EventArgs.Empty);
}
