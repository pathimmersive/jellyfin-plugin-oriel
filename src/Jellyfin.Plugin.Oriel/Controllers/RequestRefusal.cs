using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Why a request was refused, as a stable code naming the field or rule.
/// </summary>
/// <param name="Reason">The code, such as invalidCfi or malformedRequest.</param>
public record RequestRefusal([property: JsonPropertyName("reason")] string Reason);
