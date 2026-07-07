using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using ScreenRecorderApp.Interop;
using ScreenRecorderApp.Services;
using ScreenRecorderApp.Windows;

namespace ScreenRecorderApp;

public partial class MainWindow : Window
{
    private const int HotkeyStopId = 0x9001;
    private const int HotkeyRestartId = 0x9002;
    private const int HotkeyPauseId = 0x9003;
    private const uint VkS = 0x53;
    private const uint VkR = 0x52;
    private const uint VkP = 0x50;

    private readonly RecordingService _recordingService = new();
    private readonly DispatcherTimer _elapsedTimer;
    private DateTime _recordingStartedAtUtc;
    private TimeSpan _pausedAccumulated;
    private DateTime? _pauseStartedUtc;
    private string _outputFolder = RecordingSettings.DefaultOutputFolder;

    private WebcamOverlayWindow? _webcamWindow;
    private ControlBarWindow? _controlBar;

    // Values captured when the user hits record, applied after the countdown finishes.
    private RecordingSettings? _pendingSettings;
    private ScreenBounds _pendingWorkArea;
    private bool _pendingCameraEnabled;
    private int _pendingCameraIndex;

    public MainWindow()
    {
        InitializeComponent();

        _elapsedTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _elapsedTimer.Tick += (_, _) => UpdateElapsedLabel();

        _recordingService.RecordingStarted += (_, _) => Dispatcher.Invoke(OnRecordingStarted);
        _recordingService.RecordingCompleted += (_, e) => Dispatcher.Invoke(() => OnRecordingCompleted(e.FilePath));
        _recordingService.RecordingFailed += (_, e) => Dispatcher.Invoke(() => OnRecordingFailed(e.Error));

        OutputPathText.Text = _outputFolder;
        LoadDevices();
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var hwnd = new WindowInteropHelper(this).Handle;

        NativeMethods.TryEnableDarkTitleBar(hwnd);

        var source = HwndSource.FromHwnd(hwnd);
        source?.AddHook(WndProc);

        uint mods = NativeMethods.MOD_CONTROL | NativeMethods.MOD_ALT | NativeMethods.MOD_NOREPEAT;
        bool stopOk = NativeMethods.RegisterHotKey(hwnd, HotkeyStopId, mods, VkS);
        bool restartOk = NativeMethods.RegisterHotKey(hwnd, HotkeyRestartId, mods, VkR);
        bool pauseOk = NativeMethods.RegisterHotKey(hwnd, HotkeyPauseId, mods, VkP);
        if (!stopOk || !restartOk || !pauseOk)
        {
            HotkeyHintText.Text = "Certains raccourcis sont indisponibles. Utilisez la barre de contrôle en bas à gauche pendant l'enregistrement.";
        }
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == NativeMethods.WM_HOTKEY)
        {
            int id = wParam.ToInt32();
            if (id == HotkeyStopId && _recordingService.IsRecording)
            {
                _recordingService.Stop();
                handled = true;
            }
            else if (id == HotkeyRestartId && _recordingService.IsRecording)
            {
                _recordingService.Restart();
                handled = true;
            }
            else if (id == HotkeyPauseId && _recordingService.IsRecording)
            {
                TogglePause();
                handled = true;
            }
        }
        return IntPtr.Zero;
    }

    private void LoadDevices()
    {
        try
        {
            var screens = DeviceService.GetScreens();
            SetupCombo(ScreenComboBox, screens);

            var webcams = DeviceService.GetWebcams();
            SetupCombo(WebcamComboBox, webcams);
            WebcamCheckBox.IsEnabled = webcams.Count > 0;

            var microphones = DeviceService.GetMicrophones();
            SetupCombo(MicrophoneComboBox, microphones);
            MicrophoneCheckBox.IsEnabled = microphones.Count > 0;
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Impossible de lister les périphériques : {ex.Message}";
        }
    }

    private static void SetupCombo(System.Windows.Controls.ComboBox combo, System.Collections.Generic.List<DeviceOption> items)
    {
        combo.DisplayMemberPath = nameof(DeviceOption.Label);
        combo.ItemsSource = items;
        if (items.Count > 0)
            combo.SelectedIndex = 0;
    }

    private void WebcamCheckBox_Toggled(object sender, RoutedEventArgs e)
    {
        WebcamComboBox.IsEnabled = WebcamCheckBox.IsChecked == true && WebcamComboBox.Items.Count > 0;
    }

    private void MicrophoneCheckBox_Toggled(object sender, RoutedEventArgs e)
    {
        MicrophoneComboBox.IsEnabled = MicrophoneCheckBox.IsChecked == true && MicrophoneComboBox.Items.Count > 0;
    }

    private void RecordButton_Click(object sender, RoutedEventArgs e)
    {
        if (_recordingService.IsRecording)
        {
            StatusText.Text = "Finalisation de la vidéo…";
            RecordButton.IsEnabled = false;
            RestartButton.IsEnabled = false;
            _recordingService.Stop();
        }
        else
        {
            BeginStartFlow();
        }
    }

    private void RestartButton_Click(object sender, RoutedEventArgs e)
    {
        if (_recordingService.IsRecording)
        {
            StatusText.Text = "Redémarrage de l'enregistrement…";
            _recordingService.Restart();
        }
    }

    private void BeginStartFlow()
    {
        if (ScreenComboBox.SelectedItem is not DeviceOption screen)
        {
            MessageBox.Show(this, "Aucun écran détecté.", "Enregistreur d'écran", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var includeMic = MicrophoneCheckBox.IsChecked == true && MicrophoneComboBox.SelectedItem is DeviceOption;
        _pendingSettings = new RecordingSettings
        {
            ScreenDeviceName = screen.Id,
            IncludeMicrophone = includeMic,
            MicrophoneDeviceName = includeMic ? ((DeviceOption)MicrophoneComboBox.SelectedItem).Id : null,
            OutputFolder = _outputFolder,
            // Crop the taskbar strip out of the video; it stays visible on screen.
            Crop = ScreenHelper.GetTaskbarCrop(screen.Id)
        };

        _pendingWorkArea = ScreenHelper.GetWorkAreaForDevice(screen.Id, this);
        _pendingCameraEnabled = WebcamCheckBox.IsChecked == true && WebcamComboBox.SelectedItem is DeviceOption;
        _pendingCameraIndex = _pendingCameraEnabled ? ((DeviceOption)WebcamComboBox.SelectedItem).Index : -1;

        // Lock the UI, clear the screen, then run the countdown.
        SettingsPanel.IsEnabled = false;
        RecordButton.IsEnabled = false;
        StatusText.Text = "Préparation…";

        // Minimize now so the user has a clear screen to arrange things during the countdown.
        WindowState = WindowState.Minimized;

        // Show the camera bubble during the countdown (framing); it continues into the recording.
        StartWebcam();

        var countdown = new CountdownWindow(_pendingWorkArea);
        countdown.Completed += (_, _) => StartActualRecording();
        countdown.Show();
    }

    private void StartWebcam()
    {
        if (!_pendingCameraEnabled)
            return;

        try
        {
            _webcamWindow = new WebcamOverlayWindow(_pendingWorkArea, _pendingCameraIndex);
            _webcamWindow.Failed += (_, msg) => Dispatcher.Invoke(() => OnWebcamFailed(msg));
            _webcamWindow.Show();
            _webcamWindow.Start();
        }
        catch (Exception ex)
        {
            OnWebcamFailed(ex.Message);
        }
    }

    private void StartActualRecording()
    {
        if (_pendingSettings is null)
            return;

        // The webcam bubble is already on screen; the app is already minimized. Just record.
        try
        {
            _recordingService.Start(_pendingSettings);
        }
        catch (Exception ex)
        {
            TeardownRecordingChrome();
            ResetIdleUi();
            StatusText.Text = $"Impossible de démarrer : {ex.Message}";
            MessageBox.Show(this, ex.Message, "Enregistreur d'écran", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OnWebcamFailed(string message)
    {
        // The camera bubble failed, but screen + mic recording can continue.
        _webcamWindow?.StopAndClose();
        _webcamWindow = null;
        StatusText.Text = $"Caméra indisponible ({message}). L'enregistrement continue sans caméra.";
    }

    private void OnRecordingStarted()
    {
        _recordingStartedAtUtc = DateTime.UtcNow;
        _pausedAccumulated = TimeSpan.Zero;
        _pauseStartedUtc = null;
        _elapsedTimer.Start();

        RecordButton.Content = "Arrêter";
        RecordButton.IsEnabled = true;
        RestartButton.IsEnabled = true;
        SettingsPanel.IsEnabled = false;
        StatusText.Text = "Enregistrement en cours…";
        ElapsedText.Text = "00:00:00";

        // Keep the app window itself out of the video if the user brings it back up.
        NativeMethods.TryExcludeFromCapture(new WindowInteropHelper(this).Handle);

        ShowControlBar();
        _controlBar?.SetPaused(false);
        _controlBar?.SetElapsed("0:00");
    }

    private void ShowControlBar()
    {
        // Created once; reused across restarts (which re-raise RecordingStarted).
        if (_controlBar != null)
            return;

        _controlBar = new ControlBarWindow(_pendingWorkArea);
        _controlBar.StopRequested += (_, _) =>
        {
            if (_recordingService.IsRecording)
            {
                StatusText.Text = "Finalisation de la vidéo…";
                _recordingService.Stop();
            }
        };
        _controlBar.RestartRequested += (_, _) =>
        {
            if (_recordingService.IsRecording)
                _recordingService.Restart();
        };
        _controlBar.PauseResumeRequested += (_, _) => TogglePause();
        _controlBar.Show();
    }

    private void TogglePause()
    {
        if (!_recordingService.IsRecording)
            return;

        if (_recordingService.IsPaused)
        {
            _recordingService.Resume();
            if (_pauseStartedUtc.HasValue)
            {
                _pausedAccumulated += DateTime.UtcNow - _pauseStartedUtc.Value;
                _pauseStartedUtc = null;
            }
            _controlBar?.SetPaused(false);
            StatusText.Text = "Enregistrement en cours…";
        }
        else
        {
            _recordingService.Pause();
            _pauseStartedUtc = DateTime.UtcNow;
            _controlBar?.SetPaused(true);
            StatusText.Text = "En pause.";
        }
    }

    private void OnRecordingCompleted(string filePath)
    {
        TeardownRecordingChrome();
        ResetIdleUi();
        StatusText.Text = "Vidéo enregistrée.";
        OpenFolderAndSelect(filePath);
    }

    private void OnRecordingFailed(string error)
    {
        TeardownRecordingChrome();
        ResetIdleUi();
        StatusText.Text = $"Échec de l'enregistrement : {error}";
        MessageBox.Show(this, error, "Erreur d'enregistrement", MessageBoxButton.OK, MessageBoxImage.Error);
    }

    /// <summary>Closes the webcam bubble and control bar, and brings the app window back.</summary>
    private void TeardownRecordingChrome()
    {
        _webcamWindow?.StopAndClose();
        _webcamWindow = null;

        _controlBar?.Close();
        _controlBar = null;

        _pauseStartedUtc = null;
        _pausedAccumulated = TimeSpan.Zero;

        // Re-include the app window in captures now that recording is over.
        NativeMethods.TryIncludeInCapture(new WindowInteropHelper(this).Handle);

        WindowState = WindowState.Normal;
        Activate();
    }

    private void ResetIdleUi()
    {
        _elapsedTimer.Stop();
        RecordButton.Content = "Enregistrer";
        RecordButton.IsEnabled = true;
        RestartButton.IsEnabled = false;
        SettingsPanel.IsEnabled = true;
        ElapsedText.Text = "00:00:00";
    }

    private void UpdateElapsedLabel()
    {
        // Exclude any paused time so the displayed duration matches the actual recording.
        var pausedSoFar = _pausedAccumulated + (_pauseStartedUtc.HasValue ? DateTime.UtcNow - _pauseStartedUtc.Value : TimeSpan.Zero);
        var elapsed = DateTime.UtcNow - _recordingStartedAtUtc - pausedSoFar;
        if (elapsed < TimeSpan.Zero)
            elapsed = TimeSpan.Zero;

        ElapsedText.Text = elapsed.ToString(@"hh\:mm\:ss");
        _controlBar?.SetElapsed(elapsed.ToString(elapsed.TotalHours >= 1 ? @"h\:mm\:ss" : @"m\:ss"));
    }

    private static void OpenFolderAndSelect(string filePath)
    {
        try
        {
            if (File.Exists(filePath))
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{filePath}\"") { UseShellExecute = true });
            else
                Process.Start(new ProcessStartInfo(Path.GetDirectoryName(filePath) ?? "") { UseShellExecute = true });
        }
        catch
        {
            // Opening Explorer is a convenience; ignore failures.
        }
    }

    private void ChooseFolderButton_Click(object sender, RoutedEventArgs e)
    {
        using var dialog = new System.Windows.Forms.FolderBrowserDialog
        {
            Description = "Choisir le dossier de sortie des vidéos",
            UseDescriptionForTitle = true,
            SelectedPath = Directory.Exists(_outputFolder) ? _outputFolder : RecordingSettings.DefaultOutputFolder
        };

        if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
        {
            _outputFolder = dialog.SelectedPath;
            OutputPathText.Text = _outputFolder;
        }
    }

    private void OpenFolderButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Directory.CreateDirectory(_outputFolder);
            Process.Start(new ProcessStartInfo(_outputFolder) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Impossible d'ouvrir le dossier : {ex.Message}";
        }
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_recordingService.IsRecording)
        {
            MessageBox.Show(this, "Arrêtez l'enregistrement avant de fermer l'application.", "Enregistreur d'écran", MessageBoxButton.OK, MessageBoxImage.Warning);
            e.Cancel = true;
            return;
        }

        base.OnClosing(e);
    }

    protected override void OnClosed(EventArgs e)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd != IntPtr.Zero)
        {
            NativeMethods.UnregisterHotKey(hwnd, HotkeyStopId);
            NativeMethods.UnregisterHotKey(hwnd, HotkeyRestartId);
            NativeMethods.UnregisterHotKey(hwnd, HotkeyPauseId);
        }

        _webcamWindow?.StopAndClose();
        _controlBar?.Close();
        _recordingService.Dispose();
        base.OnClosed(e);
    }
}
