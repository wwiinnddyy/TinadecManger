using Aprillz.MewUI;
using Aprillz.MewUI.Controls;
using TinadecManger.App.Pages;
using TinadecManger.Core;

namespace TinadecManger.App;

internal static class Assets
{
    public static string Path(string name) =>
        System.IO.Path.Combine(AppContext.BaseDirectory, "assets", name);
}

/// <summary>Main window factory: brand sidebar + swappable content area.</summary>
internal sealed class Shell
{
    private readonly ManagerService _service;
    private readonly Dictionary<string, Button> _navButtons = [];
    private readonly Border _content = new Border();

    private static readonly (string Id, string Label)[] Pages =
    [
        ("dashboard", "仪表盘"),
        ("components", "组件"),
        ("settings", "设置"),
    ];

    private Shell(ManagerService service) => _service = service;

    public static Window CreateMainWindow(ManagerService service)
    {
        var shell = new Shell(service);
        var window = new Window
        {
            Title = "TinadecManger",
            Content = shell.BuildRoot(),
        };
        window.Resizable(1080, 680, minWidth: 860);

        try
        {
            window.Icon = IconSource.FromFile(Assets.Path("tinadec-logo.png"));
        }
        catch
        {
            // window icon is cosmetic; never block startup over it
        }

        shell.ShowPage("dashboard");
        return window;
    }

    private Element BuildRoot() =>
        new DockPanel()
            .LastChildFill()
            .Children(
                BuildSidebar().DockLeft().Width(230),
                _content.Background(Branding.DeepBackground));

    private Border BuildSidebar()
    {
        var navStack = new StackPanel().Vertical().Spacing(4).Padding(new Thickness(12, 8));
        foreach (var (id, label) in Pages)
        {
            var button = new Button()
                .Content(label)
                .OnClick(() => ShowPage(id));
            _navButtons[id] = button;
            navStack.Children(button);
        }

        return new Border()
            .Background(Branding.DarkSidebar)
            .Child(new DockPanel()
                .LastChildFill()
                .Children(
                    BuildBrandHeader().DockTop(),
                    new TextBlock()
                        .Text($"TinadecManger v{typeof(Shell).Assembly.GetName().Version?.ToString(3) ?? "0.1.0"}")
                        .Foreground(Branding.TextSecondary)
                        .FontSize(11)
                        .DockBottom()
                        .Margin(new Thickness(16, 0, 0, 12)),
                    navStack));
    }

    private static Element BuildBrandHeader()
    {
        var header = new StackPanel().Vertical().Spacing(2).Padding(new Thickness(16, 20, 16, 12));

        try
        {
            header.Children(new Image().SourceFile(Assets.Path("logo-white.png")).Height(52)
                .HorizontalAlignment(HorizontalAlignment.Left));
        }
        catch
        {
            // logo missing: fall back to text branding only
        }

        header.Children(
            new TextBlock().Text("TinadecOffice").FontSize(16).Bold().Foreground(Branding.DarkText),
            new TextBlock().Text("生态链管理器").FontSize(12).Foreground(Branding.TextSecondary));
        return header;
    }

    private void ShowPage(string id)
    {
        _content.Child = id switch
        {
            "dashboard" => new DashboardPage(_service).Build(),
            "components" => new ComponentsPage(_service).Build(),
            "settings" => new SettingsPage(_service).Build(),
            _ => new TextBlock().Text("未知页面"),
        };

        foreach (var (pageId, button) in _navButtons)
        {
            var active = pageId == id;
            var label = Pages.First(p => p.Id == pageId).Label;
            button.Content(active ? $"▸ {label}" : $"   {label}");
            button.Background(active ? Branding.Accent.WithAlpha(0x2E) : Color.FromArgb(0, 0, 0, 0));
            button.Foreground(active ? Branding.Accent : Branding.DarkText);
        }
    }
}
