using System;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using ScreenRecorderApp.Interop;
using ScreenRecorderApp.Services;

namespace ScreenRecorderApp.Windows;

/// <summary>
/// Compact, click-through "3 · 2 · 1" overlay shown near the top of the target screen.
/// It does not block the desktop, so the user can prepare their screen during the countdown.
/// It closes before recording starts, so it never appears in the video.
/// </summary>
public partial class CountdownWindow : Window
{
    private readonly DispatcherTimer _timer;
    private int _current;
    private bool _finished;

    /// <summary>Raised once the countdown reaches zero and the window has fully closed.</summary>
    public event EventHandler? Completed;

    public CountdownWindow(ScreenBounds screen, int startFrom = 3)
    {
        InitializeComponent();

        // Top-center of the target screen, out of the way of the user's work.
        Left = screen.Left + (screen.Width - Width) / 2;
        Top = screen.Top + Math.Min(120, screen.Height * 0.12);

        _current = startFrom;
        NumberText.Text = _current.ToString();

        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _timer.Tick += OnTick;

        Loaded += (_, _) =>
        {
            AnimateNumber();
            _timer.Start();
        };
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // Let mouse/keyboard pass through to whatever is underneath during the countdown.
        NativeMethods.MakeClickThrough(new WindowInteropHelper(this).Handle);
    }

    private void OnTick(object? sender, EventArgs e)
    {
        _current--;
        if (_current <= 0)
        {
            _timer.Stop();
            _finished = true;
            Close(); // Completed is raised from OnClosed, once our pixels are gone.
            return;
        }

        NumberText.Text = _current.ToString();
        AnimateNumber();
    }

    protected override void OnClosed(EventArgs e)
    {
        base.OnClosed(e);
        if (_finished)
            Completed?.Invoke(this, EventArgs.Empty);
    }

    private void AnimateNumber()
    {
        var scale = new DoubleAnimation(1.4, 1.0, TimeSpan.FromMilliseconds(350))
        {
            EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.4 }
        };
        NumberScale.BeginAnimation(System.Windows.Media.ScaleTransform.ScaleXProperty, scale);
        NumberScale.BeginAnimation(System.Windows.Media.ScaleTransform.ScaleYProperty, scale);
    }
}
