using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Gives every refusal from an Oriel endpoint a reason and logs it: a body the framework could not
/// read becomes <c>{ reason: "malformedRequest" }</c>, and each 4xx with a reason is logged at Warning
/// when it points at misuse or a limit, else at Debug. Only the route template is logged, never the
/// request's path or query, which can hold a reader's words.
/// </summary>
public sealed partial class RefusalsAttribute : ResultFilterAttribute
{
    /// <summary>
    /// The reasons logged at Warning; every other refusal is logged at Debug.
    /// </summary>
    public static readonly IReadOnlySet<string> WarningReasons = new HashSet<string>(StringComparer.Ordinal)
    {
        "notAFont", "tooMany", "quotaFull", "uploadsOff", "tooLarge", "notAnExport", "newerVersion", "malformed", "limitReached", "importRunning",
    };

    /// <inheritdoc />
    public override void OnResultExecuting(ResultExecutingContext context)
    {
        // The framework's own 400 for a body it could not bind, before the action ran.
        if (context.Result is BadRequestObjectResult { Value: ValidationProblemDetails or ProblemDetails })
        {
            context.Result = new BadRequestObjectResult(new RequestRefusal("malformedRequest"));
        }

        if (context.Result is ObjectResult { StatusCode: >= 400 and < 500 and not 401 and not 404 } refused && ReasonOf(refused.Value) is { } reason)
        {
            var logger = context.HttpContext.RequestServices?.GetService<ILoggerFactory>()?.CreateLogger<RefusalsAttribute>()
                ?? NullLogger<RefusalsAttribute>.Instance;
            var route = context.ActionDescriptor.AttributeRouteInfo?.Template ?? context.ActionDescriptor.DisplayName ?? "?";
            var method = context.HttpContext.Request.Method;
            var status = refused.StatusCode ?? StatusCodes.Status400BadRequest;
            if (WarningReasons.Contains(reason))
            {
                LogRefusedWarning(logger, method, route, status, reason);
            }
            else
            {
                LogRefusedDebug(logger, method, route, status, reason);
            }
        }

        base.OnResultExecuting(context);
    }

    // The reason of any of Oriel's refusal bodies: a record with a string Reason.
    private static string? ReasonOf(object? body) =>
        body?.GetType().GetProperty("Reason")?.GetValue(body) as string;

    [LoggerMessage(Level = LogLevel.Warning, Message = "Oriel refused {Method} /{Route} with {Status}: {Reason}")]
    private static partial void LogRefusedWarning(ILogger logger, string method, string route, int status, string reason);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Oriel refused {Method} /{Route} with {Status}: {Reason}")]
    private static partial void LogRefusedDebug(ILogger logger, string method, string route, int status, string reason);
}
