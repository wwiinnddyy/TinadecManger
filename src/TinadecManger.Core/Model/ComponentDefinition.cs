namespace TinadecManger.Core.Model;

/// <summary>Immutable description of a known Tinadec ecosystem component.</summary>
public sealed record ComponentDefinition(
    string Id,
    string Name,
    ComponentFamily Family,
    DeliveryKind Delivery,
    ProbeKind Probe,
    string ProbeTarget,
    string ExpectedArtifact,
    string Description,
    bool AllowMultipleInstances = false,
    bool SupportsStandaloneLaunch = true)
{
    public string FamilyLabel => Family switch
    {
        ComponentFamily.Core => "TinadecCore",
        ComponentFamily.Gateway => "TinadecGateway",
        ComponentFamily.Tools => "TinadecTools",
        ComponentFamily.App => "TinadecApps",
        _ => Family.ToString(),
    };
}

public sealed record ComponentProbeResult(
    ComponentStatus Status,
    string? Version,
    string Message,
    DateTimeOffset CheckedAtUtc);
