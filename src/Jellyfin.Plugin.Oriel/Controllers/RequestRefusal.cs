using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Why a request was refused, as a stable code naming the field, rule or limit. Every refusal of an Oriel
/// endpoint that gives a reason answers with this record.
/// </summary>
/// <param name="Reason">The code, such as invalidCfi, malformedRequest, limitReached, notAFont or storeUnavailable.</param>
public record RequestRefusal([property: JsonPropertyName("reason")] string Reason);
