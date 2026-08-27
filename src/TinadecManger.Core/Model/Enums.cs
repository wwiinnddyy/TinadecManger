namespace TinadecManger.Core.Model;

public enum ComponentFamily
{
    Core,
    Gateway,
    Tools,
    App,
}

public enum DeliveryKind
{
    DotNetPublishDir,
    NativeExe,
    BunScript,
    PortableExe,
    YuiApp,
}

public enum ProbeKind
{
    HttpHealth,
    ProcessName,
    FileOnly,
}

public enum ComponentStatus
{
    Probing,
    Running,
    Stopped,
    Unhealthy,
    NotInstalled,
}
