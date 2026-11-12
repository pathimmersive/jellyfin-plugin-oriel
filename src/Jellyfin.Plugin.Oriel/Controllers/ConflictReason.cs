using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Why a request was refused with 409.
/// </summary>
/// <param name="Reason">limitReached or importRunning.</param>
public record ConflictReason([property: JsonPropertyName("reason")] string Reason);
