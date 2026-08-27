using TinadecManger.Core.Catalog;
using TinadecManger.Core.Lifecycle;
using TinadecManger.Core.Model;
using TinadecManger.Core.Probing;
using TinadecManger.Core.Registry;
using TinadecManger.Core.Settings;

namespace TinadecManger.Core;

/// <summary>Single facade consumed by the UI layer.</summary>
public sealed class ManagerService
{
    private readonly InstallRegistry _registry = new();
    private readonly SettingsStore _settings = new();
    private readonly ComponentProber _prober = new();
    private readonly ComponentLauncher _launcher = new();

    public IReadOnlyList<ComponentDefinition> Catalog => BuiltInCatalog.All;

    public MangerSettings LoadSettings() => _settings.Load();

    public OperationResult SaveSettings(MangerSettings settings)
    {
        try
        {
            _settings.Save(settings);
            return OperationResult.Success("设置已保存。");
        }
        catch (Exception ex)
        {
            return OperationResult.Failure($"保存失败：{ex.Message}");
        }
    }

    public IReadOnlyList<InstalledComponent> GetInstallations() => _registry.Load().Components;

    public InstalledComponent? FindInstallation(string registrationId) =>
        _registry.Load().Components.FirstOrDefault(c => c.Id == registrationId);

    /// <summary>
    /// Validates a user-supplied path against the component's delivery kind
    /// and registers it. The registration id is unique for single-instance
    /// components; app-family components get a suffixed id per registration.
    /// </summary>
    public OperationResult Register(string definitionId, string rawPath, string? endpointOverride)
    {
        var definition = BuiltInCatalog.Find(definitionId);
        if (definition is null)
            return OperationResult.Failure("未知的组件类型。");

        var path = rawPath.Trim().Trim('"');
        if (path.Length == 0)
            return OperationResult.Failure("请填写安装目录或可执行文件路径。");

        var validation = ValidatePath(definition, path);
        if (validation is not null)
            return OperationResult.Failure(validation);

        try
        {
            var file = _registry.Load();
            var registrationId = definition.AllowMultipleInstances
                ? $"{definition.Id}:{Guid.NewGuid():N}"[..Math.Min(definition.Id.Length + 9, definition.Id.Length + 33)]
                : definition.Id;

            if (!definition.AllowMultipleInstances && file.Components.Any(c => c.Id == registrationId))
                return OperationResult.Failure($"{definition.Name} 已注册，请先注销旧记录。");

            file.Components.Add(new InstalledComponent
            {
                Id = registrationId,
                Path = path,
                EndpointOverride = string.IsNullOrWhiteSpace(endpointOverride) ? null : endpointOverride.Trim(),
            });
            _registry.Save(file);
            return OperationResult.Success($"已注册 {definition.Name}。");
        }
        catch (Exception ex)
        {
            return OperationResult.Failure($"注册失败：{ex.Message}");
        }
    }

    public OperationResult Unregister(string registrationId)
    {
        try
        {
            var file = _registry.Load();
            var removed = file.Components.RemoveAll(c => c.Id == registrationId);
            if (removed == 0)
                return OperationResult.Failure("未找到该注册记录。");
            _registry.Save(file);
            return OperationResult.Success("已注销（不会删除磁盘文件）。");
        }
        catch (Exception ex)
        {
            return OperationResult.Failure($"注销失败：{ex.Message}");
        }
    }

    public async Task<ComponentProbeResult> ProbeAsync(string registrationId, CancellationToken ct = default)
    {
        var (definition, installation) = Resolve(registrationId);
        if (definition is null)
            return new ComponentProbeResult(ComponentStatus.NotInstalled, null, "未知组件。", DateTimeOffset.UtcNow);

        var result = await _prober.ProbeAsync(definition, installation, ct);
        if (result.Version is not null && installation is not null)
        {
            installation.LastKnownVersion = result.Version;
            PersistVersion(installation);
        }
        return result;
    }

    public Task<OperationResult> StartAsync(string registrationId)
    {
        var (definition, installation) = Resolve(registrationId);
        if (definition is null || installation is null)
            return Task.FromResult(OperationResult.Failure("组件未注册。"));
        return _launcher.StartAsync(definition, installation);
    }

    public Task<OperationResult> StopAsync(string registrationId)
    {
        var (definition, installation) = Resolve(registrationId);
        if (definition is null || installation is null)
            return Task.FromResult(OperationResult.Failure("组件未注册。"));
        return _launcher.StopAsync(definition, installation);
    }

    public static string? ValidatePath(ComponentDefinition definition, string path) =>
        definition.Delivery switch
        {
            DeliveryKind.BunScript when !File.Exists(Path.Combine(path, "src", "index.ts"))
                => $"该目录下未找到 src/index.ts。",
            DeliveryKind.BunScript => null,
            _ when !ProcessProbe.ArtifactExists(path, definition.ExpectedArtifact)
                => $"未找到预期产物（{definition.ExpectedArtifact}），请检查路径。",
            _ => null,
        };

    private (ComponentDefinition? Definition, InstalledComponent? Installation) Resolve(string registrationId)
    {
        var installation = FindInstallation(registrationId);
        if (installation is null)
            return (BuiltInCatalog.Find(registrationId), null);

        var baseId = registrationId.Contains(':') ? registrationId[..registrationId.IndexOf(':')] : registrationId;
        return (BuiltInCatalog.Find(baseId), installation);
    }

    private void PersistVersion(InstalledComponent installation)
    {
        try
        {
            var file = _registry.Load();
            var entry = file.Components.FirstOrDefault(c => c.Id == installation.Id);
            if (entry is not null)
            {
                entry.LastKnownVersion = installation.LastKnownVersion;
                _registry.Save(file);
            }
        }
        catch
        {
            // version persistence is best-effort; probing must never fail because of it
        }
    }
}
