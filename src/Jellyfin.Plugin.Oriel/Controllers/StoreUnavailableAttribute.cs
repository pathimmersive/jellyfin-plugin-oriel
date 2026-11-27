using System.Text.Json.Serialization;
using Jellyfin.Plugin.Oriel.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Data.Sqlite;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Answers 503 with <c>{ reason: "storeUnavailable" }</c> when the reading data store cannot be opened, or
/// when a request waited out the busy timeout behind another writer. Once an answer has begun the exception is
/// left to end the connection, so the caller does not take part of the answer for all of it.
/// </summary>
public sealed class StoreUnavailableAttribute : ExceptionFilterAttribute
{
    // SQLITE_BUSY: the database stayed locked for the whole busy timeout.
    private const int SqliteBusy = 5;

    /// <inheritdoc />
    public override void OnException(ExceptionContext context)
    {
        if (!context.HttpContext.Response.HasStarted
            && context.Exception is StoreUnavailableException or SqliteException { SqliteErrorCode: SqliteBusy })
        {
            context.Result = new ObjectResult(new RequestRefusal("storeUnavailable")) { StatusCode = StatusCodes.Status503ServiceUnavailable };
            context.ExceptionHandled = true;
        }
    }
}
