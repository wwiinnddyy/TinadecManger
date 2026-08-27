using System.Text.Json;
using System.Text.Json.Serialization;

namespace TinadecManger.Core.Registry;

/// <summary>Source-generated JSON context so registry I/O stays trim/AOT safe.</summary>
[JsonSourceGenerationOptions(WriteIndented = true, PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(RegistryFile))]
public partial class RegistryJsonContext : JsonSerializerContext
{
}
