using System.Collections.Concurrent;
using System.Diagnostics;
using TinadecManger.Core.Model;
using TinadecManger.Core.Registry;

namespace TinadecManger.Core.Lifecycle;

/// <summary>
/// Starts and stops registered components. Tracks processes launched by this
/// session so Stop can kill the exact tree; external processes are matched
/// by process name + main-module path when the OS permits it.
/// </summary>
public sealed class ComponentLauncher
{
    private readonly ConcurrentDictionary<string, Process> _launched = new();

    public Task<OperationResult> StartAsync(ComponentDefinition definition, InstalledComponent installation)
    {
        if (!definition.SupportsStandaloneLaunch)
            return Task.FromResult(OperationResult.Failure(
                $"{definition.Name} 不支持独立启动（由 Core 作为子进程托管）。"));

        try
        {
            var process = definition.Delivery switch
            {
                DeliveryKind.DotNetPublishDir or DeliveryKind.PortableExe or DeliveryKind.NativeExe
                    => StartExecutable(installation),
                DeliveryKind.BunScript => StartBunScript(installation),
                _ => throw new InvalidOperationException($"{definition.Delivery} 暂不支持启动。"),
            };
            _launched[installation.Id] = process;
            return Task.FromResult(OperationResult.Success($"已启动 {definition.Name}（PID {process.Id}）。"));
        }
        catch (Exception ex)
        {
            return Task.FromResult(OperationResult.Failure($"启动失败：{ex.Message}"));
        }
    }

    public Task<OperationResult> StopAsync(ComponentDefinition definition, InstalledComponent installation)
    {
        if (_launched.TryRemove(installation.Id, out var launched))
        {
            try
            {
                if (!launched.HasExited)
                {
                    launched.Kill(entireProcessTree: true);
                    return Task.FromResult(OperationResult.Success($"已停止 {definition.Name}（PID {launched.Id}）。"));
                }
                return Task.FromResult(OperationResult.Success($"{definition.Name} 已退出（PID {launched.Id}）。"));
            }
            catch (Exception ex)
            {
                return Task.FromResult(OperationResult.Failure($"停止失败：{ex.Message}"));
            }
        }

        try
        {
            var victims = Process.GetProcessesByName(definition.ProbeTarget)
                .Where(p => MatchesInstallation(p, installation))
                .ToList();
            if (victims.Count == 0)
                return Task.FromResult(OperationResult.Failure(
                    $"{definition.Name} 未在运行（或无法定位非本程序启动的进程）。"));

            foreach (var victim in victims)
                victim.Kill(entireProcessTree: true);
            return Task.FromResult(OperationResult.Success($"已停止 {victims.Count} 个 {definition.Name} 进程。"));
        }
        catch (Exception ex)
        {
            return Task.FromResult(OperationResult.Failure($"停止失败：{ex.Message}"));
        }
    }

    private static Process StartExecutable(InstalledComponent installation)
    {
        var executable = ResolveExecutable(installation);
        return Process.Start(new ProcessStartInfo
        {
            FileName = executable,
            WorkingDirectory = Directory.Exists(installation.Path)
                ? installation.Path
                : Path.GetDirectoryName(installation.Path) ?? installation.Path,
            UseShellExecute = false,
        }) ?? throw new InvalidOperationException("进程创建返回空。");
    }

    private static Process StartBunScript(InstalledComponent installation)
    {
        var entry = Path.Combine(installation.Path, "src", "index.ts");
        if (!File.Exists(entry))
            throw new InvalidOperationException($"未找到入口 {entry}。");
        return Process.Start(new ProcessStartInfo
        {
            FileName = OperatingSystem.IsWindows() ? "bun.exe" : "bun",
            Arguments = $"run \"{entry}\"",
            WorkingDirectory = installation.Path,
            UseShellExecute = false,
        }) ?? throw new InvalidOperationException("进程创建返回空（可能未安装 bun）。");
    }

    private static string ResolveExecutable(InstalledComponent installation)
    {
        if (installation.Executable is { Length: > 0 } exe)
        {
            var explicitPath = Path.IsPathRooted(exe) ? exe : Path.Combine(installation.Path, exe);
            if (File.Exists(explicitPath))
                return explicitPath;
            throw new InvalidOperationException($"注册的可执行文件不存在：{explicitPath}");
        }

        if (File.Exists(installation.Path))
            return installation.Path;

        if (Directory.Exists(installation.Path))
        {
            var candidate = Directory.EnumerateFiles(installation.Path, "*.exe", SearchOption.TopDirectoryOnly)
                .FirstOrDefault(f => !Path.GetFileName(f).StartsWith("TinadecManger", StringComparison.OrdinalIgnoreCase));
            if (candidate is not null)
                return candidate;

            // Non-Windows publish directories carry an extension-less apphost.
            candidate = Directory.EnumerateFiles(installation.Path)
                .FirstOrDefault(IsLikelyAppHost);
            if (candidate is not null)
                return candidate;
        }

        throw new InvalidOperationException("无法在注册路径中定位可执行文件。");
    }

    private static bool IsLikelyAppHost(string path)
    {
        var name = Path.GetFileName(path);
        return !name.Contains('.') && !name.StartsWith("lib", StringComparison.OrdinalIgnoreCase);
    }

    private static bool MatchesInstallation(Process process, InstalledComponent installation)
    {
        try
        {
            var modulePath = process.MainModule?.FileName;
            if (modulePath is null)
                return true; // cannot verify; allow stop by name
            return modulePath.StartsWith(installation.Path, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return true; // access denied reading modules; allow stop by name
        }
    }
}
