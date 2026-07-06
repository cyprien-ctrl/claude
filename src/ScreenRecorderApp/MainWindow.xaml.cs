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
    private const uint VkS = 0x53;
    private const uint VkR = 0x52;

    private readonly RecordingService _recordingService = new();
    private readonly DispatcherTimer _elapsedTimer;
    private DateTime _recordingStartedAtUtc;
    private string _outputFolder = RecordingSettings.DefaultOutputFolder;

    private WebcamOverlayWindow? _webcamWindow;

    // Values captured when the user hits record, applied after the countdown finishes.
    private RecordingSettings? _pendingSettings;
    private ScreenBounds _pendingScreenBounds;
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

        // Safety net: never leave the user's taskbar hidden if the process exits unexpectedly.
        AppDomain.CurrentDomain.ProcessExit += (_, _) => TaskbarService.RestoreIfHidden();

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

        bool stopOk = NativeMethods.RegisterHotKey(hwnd, HotkeyStopId, NativeMethods.MOD_CONTROL | NativeMethods.MOD_ALT | NativeMethods.MOD_NOREPEAT, VkS);
        bool restartOk = NativeMethods.RegisterHotKey(hwnd, HotkeyRestartId, NativeMethods.MOD_CONTROL | NativeMethods.MOD_ALT | NativeMethods.MOD_NOREPEAT, VkR);
        if (!stopOk || !restartOk)
        {
            HotkeyHintText.Text = "Raccourcis indisponibles (déjà utilisés ailleurs). Utilisez Alt+Tab pour revenir à l'app et cliquer sur Arrêter.";
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
            OutputFolder = _outputFolder
        };

        _pendingScreenBounds = ScreenHelper.GetBoundsForDevice(screen.Id, this);
        _pendingCameraEnabled = WebcamCheckBox.IsChecked == true && WebcamComboBox.SelectedItem is DeviceOption;
        _pendingCameraIndex = _pendingCameraEnabled ? ((DeviceOption)WebcamComboBox.SelectedItem).Index : -1;

        // Lock the UI and run the 3-2-1 countdown on the target screen.
        SettingsPanel.IsEnabled = false;
        RecordButton.IsEnabled = false;
        StatusText.Text = "Préparation…";

        var countdown = new CountdownWindow(_pendingScreenBounds) { Owner = this };
        countdown.Completed += (_, _) => StartActualRecording();
        countdown.Show();
    }

    private void StartActualRecording()
    {
        if (_pendingSettings is null)
            return;

        // Get the app and taskbar out of the way, show the webcam bubble, then record.
        WindowState = WindowState.Minimized;
        TaskbarService.Hide();

        if (_pendingCameraEnabled)
        {
            try
            {
                _webcamWindow = new WebcamOverlayWindow(_pendingScreenBounds, _pendingCameraIndex);
                _webcamWindow.Failed += (_, msg) => Dispatcher.Invoke(() => OnWebcamFailed(msg));
                _webcamWindow.Show();
                _webcamWindow.Start();
            }
            catch (Exception ex)
            {
                OnWebcamFailed(ex.Message);
            }
        }

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
        _elapsedTimer.Start();
        RecordButton.Content = "Arrêter";
        RecordButton.IsEnabled = true;
        RestartButton.IsEnabled = true;
        SettingsPanel.IsEnabled = false;
        StatusText.Text = "Enregistrement en cours…";
        ElapsedText.Text = "00:00:00";
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

    /// <summary>Closes the webcam bubble, restores the taskbar and brings the app back.</summary>
    private void TeardownRecordingChrome()
    {
        _webcamWindow?.StopAndClose();
        _webcamWindow = null;
        TaskbarService.RestoreIfHidden();
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
        var elapsed = DateTime.UtcNow - _recordingStartedAtUtc;
        ElapsedText.Text = elapsed.ToString(@"hh\:mm\:ss");
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
        }

        _webcamWindow?.StopAndClose();
        TaskbarService.RestoreIfHidden();
        _recordingService.Dispose();
        base.OnClosed(e);
    }
}
