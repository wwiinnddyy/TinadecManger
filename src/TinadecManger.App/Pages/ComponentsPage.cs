using Aprillz.MewUI;
using Aprillz.MewUI.Controls;
using TinadecManger.Core;
using TinadecManger.Core.Model;
using TinadecManger.Core.Registry;

namespace TinadecManger.App.Pages;

/// <summary>Components: register local installs, start/stop, unregister.</summary>
internal sealed class ComponentsPage
{
    private readonly ManagerService _service;
    private readonly Border _listHost = new();
    private readonly Border _detailHost = new();
    private readonly Border _registerPanel = new();
    private readonly TextBlock _registerMessage = new();
    private readonly TextBox _pathBox = new();
    private readonly TextBox _endpointBox = new();
    private readonly Button _browseButton = new();

    private ComponentDefinition? _selectedDefinition;
    private string? _selectedRegistrationId;

    public ComponentsPage(ManagerService service) => _service = service;

    public UIElement Build()
    {
        var root = new DockPanel()
            .LastChildFill()
            .Children(
                new DockPanel()
                    .LastChildFill()
                    .Padding(new Thickness(20, 18, 20, 6))
                    .DockTop()
                    .Children(
                        new ToggleButton()
                            .Content("注册组件…")
                            .DockRight()
                            .OnCheckedChanged(isChecked => _registerPanel.IsVisible(isChecked)),
                        new TextBlock().Text("组件").FontSize(18).Bold()),
                BuildRegisterPanel().DockTop(),
                new Grid()
                    .Columns("340,*")
                    .Children(
                        _listHost.Padding(new Thickness(20, 8, 8, 20)).Column(0),
                        _detailHost.Padding(new Thickness(8, 8, 20, 20)).Column(1)));
        ReloadList();
        return root;
    }

    private Element BuildRegisterPanel()
    {
        var typeCombo = new ComboBox()
            .Placeholder("选择组件类型")
            .Items(_service.Catalog, d => $"{d.Name}（{d.FamilyLabel}）", d => d.Id)
            .OnSelectionChanged(sel =>
            {
                if (sel is not ComponentDefinition d)
                    return;
                _selectedDefinition = d;
                _browseButton.Content(d.Delivery is DeliveryKind.NativeExe or DeliveryKind.PortableExe
                    ? "选择文件…"
                    : "选择目录…");
                _registerMessage.Text(d.Description).Foreground(Branding.TextSecondary);
            });

        _registerMessage.Foreground(Branding.TextSecondary);

        return _registerPanel
            .Padding(new Thickness(20, 0, 20, 12))
            .IsVisible(false)
            .Child(new Border()
                .CornerRadius(8)
                .Background(Branding.DarkCard)
                .BorderBrush(Branding.DarkBorder)
                .BorderThickness(1)
                .Padding(14)
                .Child(new StackPanel().Vertical().Spacing(8)
                    .Children(
                        new TextBlock().Text("注册本地已安装的组件").Bold(),
                        new StackPanel().Horizontal().Spacing(8).Children(
                            new TextBlock().Text("组件类型").Width(70).VerticalAlignment(VerticalAlignment.Center),
                            typeCombo.StretchHorizontal()),
                        new StackPanel().Horizontal().Spacing(8).Children(
                            new TextBlock().Text("路径").Width(70).VerticalAlignment(VerticalAlignment.Center),
                            _pathBox.Placeholder("安装目录或可执行文件路径").StretchHorizontal(),
                            _browseButton.Content("选择目录…").OnClick(BrowsePath)),
                        new StackPanel().Horizontal().Spacing(8).Children(
                            new TextBlock().Text("端点").Width(70).VerticalAlignment(VerticalAlignment.Center),
                            _endpointBox
                                .Placeholder("可选：覆盖探测端点，如 http://127.0.0.1:48731/api/v1/health")
                                .StretchHorizontal()),
                        new StackPanel().Horizontal().Spacing(8).Children(
                            new Button().Content("验证并登记").OnClick(Register),
                            _registerMessage))));
    }

    private void BrowsePath()
    {
        if (_selectedDefinition is null)
        {
            _registerMessage.Text("请先选择组件类型。").Foreground(Branding.StatusUnhealthy);
            return;
        }

        var picked = _selectedDefinition.Delivery is DeliveryKind.NativeExe or DeliveryKind.PortableExe
            ? FileDialog.OpenFile()
            : FileDialog.SelectFolder();
        if (!string.IsNullOrEmpty(picked))
            _pathBox.Text = picked;
    }

    private void Register()
    {
        if (_selectedDefinition is null)
        {
            _registerMessage.Text("请先选择组件类型。").Foreground(Branding.StatusUnhealthy);
            return;
        }

        var result = _service.Register(_selectedDefinition.Id, _pathBox.Text, _endpointBox.Text);
        _registerMessage.Text(result.Message)
            .Foreground(result.Ok ? Branding.StatusRunning : Branding.StatusMissing);
        if (result.Ok)
        {
            _pathBox.Text = "";
            _endpointBox.Text = "";
            Application.Current.MainWindow?.ShowToast(result.Message);
            ReloadList();
        }
    }

    private void ReloadList()
    {
        var installations = _service.GetInstallations();

        if (installations.Count == 0)
        {
            _listHost.Child = new Border()
                .CornerRadius(8)
                .Background(Branding.DarkCard)
                .Padding(16)
                .Child(new TextBlock()
                    .Text("尚未注册任何组件。\n点击右上角「注册组件…」登记本地已安装的 Tinadec 组件。")
                    .Foreground(Branding.TextSecondary));
            _selectedRegistrationId = null;
            RenderDetail(null);
            return;
        }

        var listBox = new ListBox()
            .Items(installations, ItemLabel, c => c.Id)
            .OnSelectionChanged(sel =>
            {
                if (sel is InstalledComponent c)
                {
                    _selectedRegistrationId = c.Id;
                    RenderDetail(c);
                }
            });
        _listHost.Child = listBox;

        var keep = installations.FirstOrDefault(c => c.Id == _selectedRegistrationId);
        if (keep is not null)
        {
            listBox.SelectedItem = keep;
            RenderDetail(keep);
        }
        else
        {
            RenderDetail(installations[0]);
            _selectedRegistrationId = installations[0].Id;
            listBox.SelectedIndex = 0;
        }
    }

    private string ItemLabel(InstalledComponent c)
    {
        var definition = DefinitionOf(c.Id);
        return $"{definition?.Name ?? c.Id} — {Shorten(c.Path)}";
    }

    private void RenderDetail(InstalledComponent? installation)
    {
        if (installation is null)
        {
            _detailHost.Child = new Border();
            return;
        }

        var definition = DefinitionOf(installation.Id);
        if (definition is null)
        {
            _detailHost.Child = new Border();
            return;
        }

        var resultLabel = new TextBlock().Foreground(Branding.TextSecondary);

        var startButton = new Button().Content("启动")
            .OnClick(() => _ = RunOperationAsync(() => _service.StartAsync(installation.Id), resultLabel));
        if (!definition.SupportsStandaloneLaunch)
            startButton.Disable().ToolTip("该组件由 Core 作为子进程托管，不支持独立启动");

        _detailHost.Child = new Border()
            .CornerRadius(8)
            .Background(Branding.DarkCard)
            .BorderBrush(Branding.DarkBorder)
            .BorderThickness(1)
            .Padding(16)
            .Child(new StackPanel().Vertical().Spacing(10)
                .Children(
                    new TextBlock().Text(definition.Name).FontSize(16).Bold(),
                    DetailRow("注册 ID", installation.Id),
                    DetailRow("产品族", definition.FamilyLabel),
                    DetailRow("路径", installation.Path),
                    DetailRow("探测端点",
                        installation.EndpointOverride ?? definition.ProbeTarget switch
                        {
                            "" => "（无 HTTP 面）",
                            var target => target,
                        }),
                    DetailRow("最近版本", installation.LastKnownVersion ?? "—"),
                    new StackPanel().Horizontal().Spacing(8).Children(
                        startButton,
                        new Button().Content("停止")
                            .OnClick(() => _ = RunOperationAsync(() => _service.StopAsync(installation.Id), resultLabel)),
                        new Button().Content("注销")
                            .OnClick(() => Unregister(installation))),
                    resultLabel));
    }

    private static Element DetailRow(string label, string value) =>
        new StackPanel().Horizontal().Spacing(8)
            .Children(
                new TextBlock().Text(label).Width(70).Foreground(Branding.TextSecondary),
                new TextBlock().Text(value).StretchHorizontal());

    private void Unregister(InstalledComponent installation)
    {
        var definition = DefinitionOf(installation.Id);
        if (!MessageBox.Confirm($"注销 {definition?.Name ?? installation.Id} 的注册记录？",
                detail: "只移除 TinadecManger 中的登记，不会删除磁盘文件。"))
            return;

        var result = _service.Unregister(installation.Id);
        Application.Current.MainWindow?.ShowToast(result.Message);
        if (result.Ok)
            _selectedRegistrationId = null;
        ReloadList();
    }

    private async Task RunOperationAsync(Func<Task<OperationResult>> operation, TextBlock resultLabel)
    {
        resultLabel.Text("执行中…").Foreground(Branding.TextSecondary);
        var result = await operation();
        Application.Current.Dispatcher!.BeginInvoke(() =>
        {
            resultLabel.Text(result.Message)
                .Foreground(result.Ok ? Branding.StatusRunning : Branding.StatusMissing);
            if (result.Ok)
                Application.Current.MainWindow?.ShowToast(result.Message);
        });
    }

    private ComponentDefinition? DefinitionOf(string registrationId)
    {
        var baseId = registrationId.Contains(':') ? registrationId[..registrationId.IndexOf(':')] : registrationId;
        return _service.Catalog.FirstOrDefault(d => d.Id == baseId);
    }

    private static string Shorten(string path) =>
        path.Length <= 46 ? path : "…" + path[^45..];
}
