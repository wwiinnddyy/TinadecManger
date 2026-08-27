using Aprillz.MewUI;

namespace TinadecManger.App;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        RegisterPlatformHost();
        Branding.Apply();
        var service = new TinadecManger.Core.ManagerService();
        Application.Run(Shell.CreateMainWindow(service));
    }

    private static void RegisterPlatformHost()
    {
        if (OperatingSystem.IsWindows())
        {
            Win32Platform.Register();
            Direct2DBackend.Register();
        }
        else if (OperatingSystem.IsMacOS())
        {
            MacOSPlatform.Register();
            MewVGMacOSBackend.Register();
        }
        else
        {
            X11Platform.Register();
            MewVGX11Backend.Register();
        }
    }
}
