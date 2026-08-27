using TinadecManger.Core.Model;
using TinadecManger.Core.Registry;

namespace TinadecManger.Core.Probing;

public interface IComponentProbe
{
    Task<ComponentProbeResult> ProbeAsync(
        ComponentDefinition definition, InstalledComponent? installation, CancellationToken ct);
}

/// <summary>
/// Probes an HTTP health endpoint. For Core the response body carries
/// {name,status,version,time}; for Gateway any HTTP response proves the
/// proxy process is alive (200 with status:ok additionally proves the
/// upstream Core is reachable through it).
/// </summary>
public sealed class HttpHealthProbe : IComponentProbe
{
    private static readonly HttpClient SharedClient = new() { Timeout = TimeSpan.FromSeconds(2) };

    public async Task<ComponentProbeResult> ProbeAsync(
        ComponentDefinition definition, InstalledComponent? installation, CancellationToken ct)
    {
        var url = installation?.EndpointOverride is { Length: > 0 } endpoint
            ? endpoint
            : definition.ProbeTarget;
        var now = DateTimeOffset.UtcNow;
        try
        {
            using var response = await SharedClient.GetAsync(url, ct);
            if (response.StatusCode == System.Net.HttpStatusCode.ServiceUnavailable)
                return new ComponentProbeResult(
                    ComponentStatus.Stopped, null, $"{url} 返回 503：服务不可用。", now);

            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
                return new ComponentProbeResult(
                    ComponentStatus.Running, null,
                    $"{UrlHost(url)} 存活（HTTP {(int)response.StatusCode}），上游可能不可达。", now);

            var version = TryReadVersion(body);
            var status = body.Contains("\"ok\"", StringComparison.Ordinal) || version is not null
                ? ComponentStatus.Running
                : ComponentStatus.Unhealthy;
            var message = status == ComponentStatus.Running
                ? $"{UrlHost(url)} 运行中，上游可达。"
                : $"{UrlHost(url)} 有响应但内容非预期。";
            return new ComponentProbeResult(status, version, message, now);
        }
        catch (HttpRequestException)
        {
            return new ComponentProbeResult(
                ComponentStatus.Stopped, null, $"{UrlHost(url)} 未运行或拒绝连接。", now);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return new ComponentProbeResult(
                ComponentStatus.Unhealthy, null, $"{UrlHost(url)} 探测超时。", now);
        }
    }

    private static string UrlHost(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : url;

    private static string? TryReadVersion(string body)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("version", out var v) ? v.GetString() : null;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }
}

/// <summary>
/// Probes a desktop/tool component by process name plus on-disk artifact
/// presence. Wildcard artifact patterns (e.g. TinadecOffice-*-portable.exe)
/// are matched within the registered directory.
/// </summary>
public sealed class ProcessProbe : IComponentProbe
{
    public Task<ComponentProbeResult> ProbeAsync(
        ComponentDefinition definition, InstalledComponent? installation, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;

        bool artifactPresent = installation is not null
            && ArtifactExists(installation.Path, definition.ExpectedArtifact);

        bool running = false;
        try
        {
            running = System.Diagnostics.Process.GetProcessesByName(definition.ProbeTarget).Length > 0;
        }
        catch (InvalidOperationException)
        {
            // process enumeration unavailable on this platform; treat as not running
        }

        if (running)
            return Task.FromResult(new ComponentProbeResult(
                ComponentStatus.Running, null, $"进程 {definition.ProbeTarget} 正在运行。", now));
        if (artifactPresent)
            return Task.FromResult(new ComponentProbeResult(
                ComponentStatus.Stopped, null, "已安装，未运行。", now));
        return Task.FromResult(new ComponentProbeResult(
            ComponentStatus.NotInstalled, null, "未找到组件文件。", now));
    }

    internal static bool ArtifactExists(string path, string expectedArtifact)
    {
        if (string.IsNullOrWhiteSpace(expectedArtifact))
            return File.Exists(path) || Directory.Exists(path);

        if (expectedArtifact.Contains('*'))
        {
            if (!Directory.Exists(path))
                return false;
            return Directory.EnumerateFiles(path, expectedArtifact, SearchOption.TopDirectoryOnly).Any();
        }

        return File.Exists(Path.Combine(path, expectedArtifact)) || File.Exists(path);
    }
}

/// <summary>File-presence probe for components without a process or HTTP surface.</summary>
public sealed class FileProbe : IComponentProbe
{
    public Task<ComponentProbeResult> ProbeAsync(
        ComponentDefinition definition, InstalledComponent? installation, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        if (installation is null)
            return Task.FromResult(new ComponentProbeResult(
                ComponentStatus.NotInstalled, null, "未注册。", now));

        var present = Directory.Exists(installation.Path) || File.Exists(installation.Path);
        return Task.FromResult(new ComponentProbeResult(
            present ? ComponentStatus.Stopped : ComponentStatus.NotInstalled,
            null,
            present ? "已安装。" : "注册路径不存在。",
            now));
    }
}

/// <summary>Dispatches probes by ProbeKind with a per-component timeout.</summary>
public sealed class ComponentProber
{
    private readonly HttpHealthProbe _http = new();
    private readonly ProcessProbe _process = new();
    private readonly FileProbe _file = new();

    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(2);

    public async Task<ComponentProbeResult> ProbeAsync(
        ComponentDefinition definition, InstalledComponent? installation, CancellationToken ct = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(Timeout);
        try
        {
            IComponentProbe probe = definition.Probe switch
            {
                ProbeKind.HttpHealth => _http,
                ProbeKind.ProcessName => _process,
                ProbeKind.FileOnly => _file,
                _ => _file,
            };
            return await probe.ProbeAsync(definition, installation, timeout.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new ComponentProbeResult(
                ComponentStatus.Unhealthy, null, "探测超时。", DateTimeOffset.UtcNow);
        }
    }
}
