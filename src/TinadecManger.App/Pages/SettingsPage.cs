using Aprillz.MewUI;
using Aprillz.MewUI.Controls;
using TinadecManger.Core;
using TinadecManger.Core.Settings;

namespace TinadecManger.App.Pages;

/// <summary>Settings: install root, service endpoints, appearance.</summary>
internal sealed class SettingsPage
{
    private readonly ManagerService _service;
    private readonly MangerSettings _settings;

    private readonly TextBox _installRootBox = new();
    private readonly TextBox _coreUrlBox = new();
    private readonly TextBox _gatewayUrlBox = new();
    private readonly ComboBox _themeCombo = new();
    private readonly TextBlock _feedback = new();

    private static readonly (string Key, string Label)[] Themes =
    [
        ("dark", "深色"),
        ("light", "浅色"),
        ("system", "跟随系统"),
    ];

    public SettingsPage(ManagerService service)
    {
        _service = service;
        _settings = service.LoadSettings();
    }

    public UIElement Build()
    {
        _feedback.Foreground(Branding.TextSecondary);

        var themeIndex = Math.Max(0, Themes.ToList().FindIndex(t => t.Key == _settings.Theme));

        return new ScrollViewer()
            .Content(new StackPanel().Vertical().Spacing(16).Padding(20)
                .Children(
                    new TextBlock().Text("设置").FontSize(18).Bold(),
                    new GroupBox()
                        .Header("安装根目录")
                        .Content(new StackPanel().Horizontal().Spacing(8).Padding(new Thickness(0, 8, 0, 0))
                            .Children(
                                _installRootBox.Text(_settings.InstallRoot)
                                    .Placeholder("组件默认安装目录，如 C:\\Tinadec")
                                    .StretchHorizontal(),
                                new Button().Content("保存").OnClick(SaveInstallRoot))),
                    new GroupBox()
                        .Header("服务端点")
                        .Content(new StackPanel().Vertical().Spacing(8).Padding(new Thickness(0, 8, 0, 0))
                            .Children(
                                LabeledBox("TinadecCore", _coreUrlBox.Text(_settings.CoreUrl)),
                                LabeledBox("TinadecGateway", _gatewayUrlBox.Text(_settings.GatewayUrl)),
                                new Button().Content("保存").OnClick(SaveEndpoints))),
                    new GroupBox()
                        .Header("外观")
                        .Content(new StackPanel().Horizontal().Spacing(8).Padding(new Thickness(0, 8, 0, 0))
                            .Children(
                                _themeCombo.Items(Themes.ToList(), t => t.Label, t => t.Key)
                                    .SelectedIndex(themeIndex),
                                new Button().Content("应用").OnClick(ApplyTheme))),
                    _feedback));
    }

    private static Element LabeledBox(string label, TextBox box) =>
        new StackPanel().Horizontal().Spacing(8)
            .Children(
                new TextBlock().Text(label).Width(110).VerticalAlignment(VerticalAlignment.Center),
                box.StretchHorizontal());

    private void SaveInstallRoot() =>
        Save(_feedback, s => s.InstallRoot = _installRootBox.Text.Trim());

    private void SaveEndpoints() =>
        Save(_feedback, s =>
        {
            s.CoreUrl = _coreUrlBox.Text.Trim();
            s.GatewayUrl = _gatewayUrlBox.Text.Trim();
        });

    private void Save(TextBlock feedback, Action<MangerSettings> mutate)
    {
        mutate(_settings);
        var result = _service.SaveSettings(_settings);
        feedback.Text(result.Message)
            .Foreground(result.Ok ? Branding.StatusRunning : Branding.StatusMissing);
        if (result.Ok)
            Application.Current.MainWindow?.ShowToast("设置已保存");
    }

    private void ApplyTheme()
    {
        var index = _themeCombo.SelectedIndex;
        var key = index >= 0 && index < Themes.Length ? Themes[index].Key : "dark";
        _settings.Theme = key;
        var result = _service.SaveSettings(_settings);

        var variant = key switch
        {
            "light" => ThemeVariant.Light,
            "system" => ThemeVariant.System,
            _ => ThemeVariant.Dark,
        };
        try
        {
            Application.Current.SetTheme(variant);
            _feedback.Text(result.Message).Foreground(Branding.StatusRunning);
        }
        catch (Exception ex)
        {
            _feedback.Text($"主题已保存，重启后生效（{ex.Message}）").Foreground(Branding.StatusUnhealthy);
        }
    }
}
