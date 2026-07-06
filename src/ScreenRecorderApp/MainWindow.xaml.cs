using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using ScreenRecorderApp.Services;

namespace ScreenRecorderApp;

public partial class MainWindow : Window
{
    private readonly RecordingService _recordingService = new();
    private readonly DispatcherTimer _elapsedTimer;
    private DateTime _recordingStartedAtUtc;
    private string _outputFolder = RecordingSettings.DefaultOutputFolder;

    public MainWindow()
    {
        InitializeComponent();

        _elapsedTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _elapsedTimer.Tick += (_, _) => UpdateElapsedLabel();

        _recordingService.RecordingStarted += (_, _) => Dispatcher.Invoke(OnRecordingStarted);
        _recordingService.RecordingCompleted += (_, e) => Dispatcher.Invoke(() => OnRecordingCompleted(e.FilePath));
        _recordingService.RecordingFailed += (_, e) => Dispatcher.Invoke(() => OnRecordingFailed(e.Error));

        OutputFolderTextBox.Text = _outputFolder;
        LoadDevices();
    }

    private void LoadDevices()
    {
        try
        {
            var screens = DeviceService.GetScreens();
            ScreenComboBox.DisplayMemberPath = nameof(DeviceOption.Label);
            ScreenComboBox.SelectedValuePath = nameof(DeviceOption.Id);
            ScreenComboBox.ItemsSource = screens;
            if (screens.Count > 0)
                ScreenComboBox.SelectedIndex = 0;

            var webcams = DeviceService.GetWebcams();
            WebcamComboBox.DisplayMemberPath = nameof(DeviceOption.Label);
            WebcamComboBox.SelectedValuePath = nameof(DeviceOption.Id);
            WebcamComboBox.ItemsSource = webcams;
            if (webcams.Count > 0)
                WebcamComboBox.SelectedIndex = 0;
            else
                WebcamCheckBox.IsEnabled = false;

            var microphones = DeviceService.GetMicrophones();
            MicrophoneComboBox.DisplayMemberPath = nameof(DeviceOption.Label);
            MicrophoneComboBox.SelectedValuePath = nameof(DeviceOption.Id);
            MicrophoneComboBox.ItemsSource = microphones;
            if (microphones.Count > 0)
                MicrophoneComboBox.SelectedIndex = 0;
            else
                MicrophoneCheckBox.IsEnabled = false;
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Impossible de lister les périphériques : {ex.Message}";
        }
    }

    private void RecordButton_Click(object sender, RoutedEventArgs e)
    {
        if (_recordingService.IsRecording)
        {
            StatusText.Text = "Finalisation de la vidéo...";
            RecordButton.IsEnabled = false;
            RestartButton.IsEnabled = false;
            _recordingService.Stop();
        }
        else
        {
            StartRecording();
        }
    }

    private void RestartButton_Click(object sender, RoutedEventArgs e)
    {
        if (!_recordingService.IsRecording)
            return;

        StatusText.Text = "Redémarrage de l'enregistrement...";
        RecordButton.IsEnabled = false;
        RestartButton.IsEnabled = false;
        _recordingService.Restart();
    }

    private void StartRecording()
    {
        if (ScreenComboBox.SelectedValue is not string screenId)
        {
            MessageBox.Show(this, "Aucun écran détecté.", "Enregistreur d'écran", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var includeWebcam = WebcamCheckBox.IsChecked == true && WebcamComboBox.SelectedValue is string;
        var includeMicrophone = MicrophoneCheckBox.IsChecked == true && MicrophoneComboBox.SelectedValue is string;

        var settings = new RecordingSettings
        {
            ScreenDeviceName = screenId,
            IncludeWebcam = includeWebcam,
            WebcamDeviceName = includeWebcam ? (string)WebcamComboBox.SelectedValue : null,
            IncludeMicrophone = includeMicrophone,
            MicrophoneDeviceName = includeMicrophone ? (string)MicrophoneComboBox.SelectedValue : null,
            OutputFolder = _outputFolder
        };

        try
        {
            _recordingService.Start(settings);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Impossible de démarrer l'enregistrement : {ex.Message}", "Enregistreur d'écran", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OnRecordingStarted()
    {
        _recordingStartedAtUtc = DateTime.UtcNow;
        _elapsedTimer.Start();
        RecordButton.Content = "Arrêter";
        RecordButton.IsEnabled = true;
        RestartButton.IsEnabled = true;
        SettingsPanel.IsEnabled = false;
        StatusText.Text = "Enregistrement en cours...";
    }

    private void OnRecordingCompleted(string filePath)
    {
        _elapsedTimer.Stop();
        RecordButton.Content = "Enregistrer";
        RecordButton.IsEnabled = true;
        RestartButton.IsEnabled = false;
        SettingsPanel.IsEnabled = true;
        ElapsedText.Text = "00:00:00";
        StatusText.Text = $"Vidéo enregistrée : {filePath}";
    }

    private void OnRecordingFailed(string error)
    {
        _elapsedTimer.Stop();
        RecordButton.Content = "Enregistrer";
        RecordButton.IsEnabled = true;
        RestartButton.IsEnabled = false;
        SettingsPanel.IsEnabled = true;
        ElapsedText.Text = "00:00:00";
        StatusText.Text = $"Échec de l'enregistrement : {error}";
        MessageBox.Show(this, error, "Erreur d'enregistrement", MessageBoxButton.OK, MessageBoxImage.Error);
    }

    private void UpdateElapsedLabel()
    {
        var elapsed = DateTime.UtcNow - _recordingStartedAtUtc;
        ElapsedText.Text = elapsed.ToString(@"hh\:mm\:ss");
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
            OutputFolderTextBox.Text = _outputFolder;
        }
    }

    private void OpenFolderButton_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(_outputFolder);
        Process.Start(new ProcessStartInfo(_outputFolder) { UseShellExecute = true });
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
        _recordingService.Dispose();
        base.OnClosed(e);
    }
}
