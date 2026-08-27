using System.Text.Json;

namespace TinadecManger.Core.Registry;

/// <summary>
/// JSON-backed install registry stored under the roaming application-data
/// directory. Writes are atomic (temp file + move); a corrupted file is kept
/// as a .bak side copy and replaced with defaults.
/// </summary>
public sealed class InstallRegistry
{
    private readonly string _registryPath;
    private readonly object _gate = new();

    public InstallRegistry()
        : this(DefaultDirectory)
    {
    }

    public InstallRegistry(string directory)
    {
        Directory.CreateDirectory(directory);
        _registryPath = Path.Combine(directory, "registry.json");
    }

    public static string DefaultDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TinadecManger");

    public RegistryFile Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_registryPath))
                return new RegistryFile();
            try
            {
                var loaded = JsonSerializer.Deserialize(
                    File.ReadAllText(_registryPath), RegistryJsonContext.Default.RegistryFile);
                return loaded ?? new RegistryFile();
            }
            catch (JsonException)
            {
                File.Move(_registryPath, _registryPath + ".bak", overwrite: true);
                return new RegistryFile();
            }
        }
    }

    public void Save(RegistryFile registry)
    {
        lock (_gate)
        {
            var json = JsonSerializer.Serialize(registry, RegistryJsonContext.Default.RegistryFile);
            var tmp = _registryPath + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, _registryPath, overwrite: true);
        }
    }
}
