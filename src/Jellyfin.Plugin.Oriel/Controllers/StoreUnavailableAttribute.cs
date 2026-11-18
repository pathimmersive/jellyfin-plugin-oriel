using System.Text.Json.Serialization;
using Jellyfin.Plugin.Oriel.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Data.Sqlite;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Answers 503 with <c>{ reason: "storeUnavailable" }</c> when the reading data store cannot be opened, or
/// when a request waited out the busy timeout behind another writer, so the reader tries again.
/// </summary>
public sealed class StoreUnavailableAttribute : ExceptionFilterAttribute
{
    // SQLITE_BUSY: the database stayed locked for the whole busy timeout.
    private const int SqliteBusy = 5;

    /// <inheritdoc />
    public override void OnException(ExceptionContext context)
    {
        if (context.Exception is StoreUnavailableException or SqliteException { SqliteErrorCode: SqliteBusy })
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
