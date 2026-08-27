using Aprillz.MewUI;
using Aprillz.MewUI.Controls;
using TinadecManger.Core;
using TinadecManger.Core.Model;
using TinadecManger.Core.Registry;

namespace TinadecManger.App.Pages;

/// <summary>Dashboard: one card per component with live health probing.</summary>
internal sealed class DashboardPage
{
    private readonly ManagerService _service;
    private readonly Dictionary<string, CardHandles> _handles = [];
    private readonly WrapPanel _cards = new();

    private sealed record CardHandles(
        Border Dot, TextBlock Version, TextBlock Message, TextBlock CheckedAt);

    public DashboardPage(ManagerService service) => _service = service;

    public UIElement Build()
    {
        _cards.Spacing(12).ItemWidth = 300;
        BuildCards();

        var root = new DockPanel()
            .LastChildFill()
            .Children(
                new DockPanel()
                    .LastChildFill()
                    .Padding(new Thickness(20, 18, 20, 6))
                    .DockTop()
                    .Children(
                        new Button().Content("刷新").DockRight().OnClick(RefreshAll),
                        new TextBlock().Text("仪表盘").FontSize(18).Bold()),
                new ScrollViewer().Content(_cards.Padding(new Thickness(20, 8, 20, 20))));

        RefreshAll();
        return root;
    }

    private void BuildCards()
    {
        var registeredIds = new HashSet<string>();

        foreach (var installation in _service.GetInstallations())
        {
            var definition = ResolveDefinition(installation.Id);
            if (definition is null)
                continue;
            AddCard(installation.Id, definition, installation.Path, installation);
            registeredIds.Add(BaseId(installation.Id));
        }

        foreach (var definition in _service.Catalog.Where(d => !registeredIds.Contains(d.Id)))
            AddCard(definition.Id, definition, definition.ProbeTarget, installation: null);
    }

    private void AddCard(string key, ComponentDefinition definition, string target,
        InstalledComponent? installation)
    {
        var dot = new Border().Width(10).Height(10).CornerRadius(5)
            .Background(Branding.StatusStopped).VerticalAlignment(VerticalAlignment.Center);
        var version = new TextBlock().Text(installation?.LastKnownVersion is string v ? $"版本 {v}" : "版本 —");
        var message = new TextBlock().Text("待探测").Foreground(Branding.TextSecondary);
        var checkedAt = new TextBlock().FontSize(11).Foreground(Branding.TextSecondary);

        var card = new Border()
            .CornerRadius(8)
            .Background(Branding.DarkCard)
            .BorderBrush(Branding.DarkBorder)
            .BorderThickness(1)
            .Padding(14)
            .Child(new StackPanel().Vertical().Spacing(7)
                .Children(
                    new StackPanel().Horizontal().Spacing(8)
                        .Children(dot, new TextBlock().Text(definition.Name).FontSize(14).Bold()),
                    new TextBlock().Text($"{definition.FamilyLabel} · {Delivery(definition.Delivery)}")
                        .Foreground(Branding.TextSecondary).FontSize(12),
                    new TextBlock().Text(target).Foreground(Branding.TextSecondary).FontSize(12),
                    version,
                    message,
                    checkedAt));

        _handles[key] = new CardHandles(dot, version, message, checkedAt);
        _cards.Children(card);
    }

    private void RefreshAll()
    {
        foreach (var handles in _handles.Values)
        {
            handles.Dot.Background(Branding.StatusUnhealthy);
            handles.Message.Text("探测中…").Foreground(Branding.TextSecondary);
            handles.CheckedAt.Text("");
        }
        _ = ProbeAllAsync(_handles.Keys.ToList());
    }

    private async Task ProbeAllAsync(IReadOnlyList<string> ids)
    {
        var tasks = ids.Select(async id =>
        {
            try
            {
                return (id, Result: await _service.ProbeAsync(id));
            }
            catch (Exception ex)
            {
                return (id, Result: new ComponentProbeResult(
                    ComponentStatus.Unhealthy, null, $"探测异常：{ex.Message}", DateTimeOffset.UtcNow));
            }
        }).ToList();

        var results = await Task.WhenAll(tasks);

        Application.Current.Dispatcher!.BeginInvoke(() =>
        {
            foreach (var (id, result) in results)
                UpdateCard(id, result);
        });
    }

    private void UpdateCard(string key, ComponentProbeResult result)
    {
        if (!_handles.TryGetValue(key, out var handles))
            return;

        handles.Dot.Background(result.Status switch
        {
            ComponentStatus.Running => Branding.StatusRunning,
            ComponentStatus.Unhealthy => Branding.StatusUnhealthy,
            ComponentStatus.NotInstalled => Branding.StatusMissing,
            _ => Branding.StatusStopped,
        });
        handles.Message.Text(result.Message).Foreground(
            result.Status == ComponentStatus.Running ? Branding.StatusRunning : Branding.TextSecondary);
        handles.Version.Text(result.Version is string v ? $"版本 {v}" : handles.Version.Text);
        handles.CheckedAt.Text($"探测于 {result.CheckedAtUtc.ToLocalTime():HH:mm:ss}");
    }

    private ComponentDefinition? ResolveDefinition(string registrationId) =>
        _service.Catalog.FirstOrDefault(d => d.Id == BaseId(registrationId));

    private static string BaseId(string registrationId) =>
        registrationId.Contains(':') ? registrationId[..registrationId.IndexOf(':')] : registrationId;

    private static string Delivery(DeliveryKind kind) => kind switch
    {
        DeliveryKind.DotNetPublishDir => "dotnet publish 目录",
        DeliveryKind.NativeExe => "原生可执行文件",
        DeliveryKind.BunScript => "Bun 应用",
        DeliveryKind.PortableExe => "便携可执行文件",
        DeliveryKind.YuiApp => "yui 应用",
        _ => kind.ToString(),
    };
}
