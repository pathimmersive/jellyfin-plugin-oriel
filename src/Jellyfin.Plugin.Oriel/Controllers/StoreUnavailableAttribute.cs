using System.Text.Json.Serialization;
using Jellyfin.Plugin.Oriel.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Answers 503 with <c>{ reason: "storeUnavailable" }</c> when the position store cannot be opened.
/// </summary>
public sealed class StoreUnavailableAttribute : ExceptionFilterAttribute
{
    /// <inheritdoc />
    public override void OnException(ExceptionContext context)
    {
        if (context.Exception is StoreUnavailableException)
        {
            context.Result = new ObjectResult(new Unavailable("storeUnavailable")) { StatusCode = StatusCodes.Status503ServiceUnavailable };
            context.ExceptionHandled = true;
        }
    }

    /// <summary>
    /// Why a request could not be answered.
    /// </summary>
    /// <param name="Reason">storeUnavailable.</param>
    public record Unavailable([property: JsonPropertyName("reason")] string Reason);
}
