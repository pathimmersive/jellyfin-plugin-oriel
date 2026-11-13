using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

// The reason an Oriel endpoint gave for refusing a request with 400.
internal static class Refused
{
    public static string Reason(IActionResult? result)
    {
        var refused = Assert.IsType<BadRequestObjectResult>(result);
        var reason = refused.Value?.GetType().GetProperty("Reason")?.GetValue(refused.Value) as string;
        Assert.False(string.IsNullOrEmpty(reason), $"the 400's body {refused.Value} names no reason");
        return reason!;
    }
}
