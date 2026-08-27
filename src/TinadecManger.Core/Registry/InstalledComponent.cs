namespace TinadecManger.Core.Registry;

/// <summary>One registered installation of an ecosystem component.</summary>
public sealed record InstalledComponent
{
    public required string Id { get; init; }
    public required string Path { get; init; }
    public string? Executable { get; init; }
    public string? EndpointOverride { get; init; }
    public DateTimeOffset RegisteredAtUtc { get; init; } = DateTimeOffset.UtcNow;
    public string? LastKnownVersion { get; set; }
}

public sealed class RegistryFile
{
    public int Version { get; set; } = 1;
    public List<InstalledComponent> Components { get; set; } = [];
}
