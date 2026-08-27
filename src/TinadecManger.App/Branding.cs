using Aprillz.MewUI;

namespace TinadecManger.App;

/// <summary>Tinadec brand palette + dark/light theme seeds.</summary>
internal static class Branding
{
    // Brand (from TinadecOffice)
    public static readonly Color Accent = Color.FromHex("#2EC4B6");      // teal primary
    public static readonly Color Button = Color.FromHex("#1F8F80");      // brand button face
    public static readonly Color DeepBackground = Color.FromHex("#0A0E14");

    // Layered dark surfaces
    public static readonly Color DarkText = Color.FromHex("#E6EDF3");
    public static readonly Color DarkPanel = Color.FromHex("#101722");
    public static readonly Color DarkCard = Color.FromHex("#141C2A");
    public static readonly Color DarkSidebar = Color.FromHex("#0D1219");
    public static readonly Color DarkBorder = Color.FromHex("#1E2836");
    public static readonly Color DarkDisabled = Color.FromHex("#171E29");

    // Light counterparts
    public static readonly Color LightBackground = Color.FromHex("#F6F8FA");
    public static readonly Color LightText = Color.FromHex("#1F2328");
    public static readonly Color LightPanel = Color.FromHex("#FFFFFF");
    public static readonly Color LightBorder = Color.FromHex("#D8DEE4");

    // Semantic status colors
    public static readonly Color StatusRunning = Color.FromHex("#3FB950");
    public static readonly Color StatusStopped = Color.FromHex("#6E7681");
    public static readonly Color StatusUnhealthy = Color.FromHex("#D29922");
    public static readonly Color StatusMissing = Color.FromHex("#F85149");

    public static readonly Color TextSecondary = Color.FromHex("#8B949E");

    public static void Apply()
    {
        ThemeManager.Default = ThemeVariant.Dark;
        ThemeManager.DefaultDarkSeed = ThemeSeed.DefaultDark with
        {
            WindowBackground = DeepBackground,
            WindowText = DarkText,
            ControlBackground = DarkPanel,
            ButtonFace = Button,
            ButtonDisabledBackground = DarkDisabled,
        };
        ThemeManager.DefaultLightSeed = ThemeSeed.DefaultLight with
        {
            WindowBackground = LightBackground,
            WindowText = LightText,
            ControlBackground = LightPanel,
            ButtonFace = Button,
        };
        ThemeManager.DefaultAccentColor = Accent;
        ThemeManager.DefaultMetrics = ThemeMetrics.Default with
        {
            FontSize = 13,
            ControlCornerRadius = 6,
        };
    }
}
