using System;
using System.Windows;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using ScreenRecorderApp.Services;

namespace ScreenRecorderApp.Windows;

public partial class CountdownWindow : Window
{
    private readonly DispatcherTimer _timer;
    private int _current;
    private bool _finished;

    /// <summary>Raised once the countdown reaches zero and the window has fully closed.</summary>
    public event EventHandler? Completed;

    public CountdownWindow(ScreenBounds bounds, int startFrom = 3)
    {
        InitializeComponent();

        Left = bounds.Left;
        Top = bounds.Top;
        Width = bounds.Width;
        Height = bounds.Height;

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
