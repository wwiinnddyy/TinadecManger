using TinadecManger.Core.Model;

namespace TinadecManger.Core.Catalog;

/// <summary>Built-in catalog of known Tinadec ecosystem components.</summary>
public static class BuiltInCatalog
{
    public static readonly IReadOnlyList<ComponentDefinition> All =
    [
        new(
            Id: "tinadec-core",
            Name: "TinadecCore",
            Family: ComponentFamily.Core,
            Delivery: DeliveryKind.DotNetPublishDir,
            Probe: ProbeKind.HttpHealth,
            ProbeTarget: "http://127.0.0.1:48731/api/v1/health",
            ExpectedArtifact: "TinadecCore.Api.exe",
            Description: "智能体编排与治理服务，生态的状态权威（端口 48731）。"),

        new(
            Id: "tinadec-gateway",
            Name: "TinadecGateway",
            Family: ComponentFamily.Gateway,
            Delivery: DeliveryKind.BunScript,
            Probe: ProbeKind.HttpHealth,
            ProbeTarget: "http://127.0.0.1:48730/api/v1/health",
            ExpectedArtifact: "src/index.ts",
            Description: "无状态 BFF/代理，Desktop 与 Core 之间的门面（端口 48730）。"),

        new(
            Id: "tinadec-tools",
            Name: "TinadecTools",
            Family: ComponentFamily.Tools,
            Delivery: DeliveryKind.NativeExe,
            Probe: ProbeKind.ProcessName,
            ProbeTarget: "TinadecTools",
            ExpectedArtifact: "TinadecTools.exe",
            Description: "审批感知工具宿主，由 Core 作为子进程托管。",
            SupportsStandaloneLaunch: false),

        new(
            Id: "tinadec-office-desktop",
            Name: "TinadecOffice Desktop",
            Family: ComponentFamily.App,
            Delivery: DeliveryKind.PortableExe,
            Probe: ProbeKind.ProcessName,
            ProbeTarget: "TinadecOffice",
            ExpectedArtifact: "TinadecOffice-*-portable.exe",
            Description: "Electron 桌面客户端（TinadecOfficeDesktop）。",
            AllowMultipleInstances: true),

        new(
            Id: "tinadec-code",
            Name: "TinadecCode",
            Family: ComponentFamily.App,
            Delivery: DeliveryKind.YuiApp,
            Probe: ProbeKind.FileOnly,
            ProbeTarget: "",
            ExpectedArtifact: "",
            Description: "yui 形态的代码智能体客户端。",
            AllowMultipleInstances: true,
            SupportsStandaloneLaunch: false),
    ];

    public static ComponentDefinition? Find(string id) =>
        All.FirstOrDefault(d => d.Id == id);
}
