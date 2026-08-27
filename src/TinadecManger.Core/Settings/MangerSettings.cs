using System.Text.Json;
using System.Text.Json.Serialization;

namespace TinadecManger.Core.Settings;

public sealed class MangerSettings
{
    public string InstallRoot { get; set; } = "";
    public string CoreUrl { get; set; } = "http://127.0.0.1:48731";
    public string GatewayUrl { get; set; } = "http://127.0.0.1:48730";
    public string Theme { get; set; } = "dark";
}

[JsonSourceGenerationOptions(WriteIndented = true, PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(MangerSettings))]
public partial class SettingsJsonContext : JsonSerializerContext
{
}

/// <summary>User settings stored next to the install registry; atomic writes, corrupt-safe reads.</summary>
public sealed class SettingsStore
{
    private readonly string _settingsPath;
    private readonly object _gate = new();

    public SettingsStore()
        : this(Registry.InstallRegistry.DefaultDirectory)
    {
    }

    public SettingsStore(string directory)
    {
        Directory.CreateDirectory(directory);
        _settingsPath = Path.Combine(directory, "settings.json");
    }

    public MangerSettings Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_settingsPath))
                return new MangerSettings();
            try
            {
                return JsonSerializer.Deserialize(
                    File.ReadAllText(_settingsPath), SettingsJsonContext.Default.MangerSettings)
                    ?? new MangerSettings();
            }
            catch (JsonException)
            {
                File.Move(_settingsPath, _settingsPath + ".bak", overwrite: true);
                return new MangerSettings();
            }
        }
    }

    public void Save(MangerSettings settings)
    {
        lock (_gate)
        {
            var json = JsonSerializer.Serialize(settings, SettingsJsonContext.Default.MangerSettings);
            var tmp = _settingsPath + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, _settingsPath, overwrite: true);
        }
    }
}
