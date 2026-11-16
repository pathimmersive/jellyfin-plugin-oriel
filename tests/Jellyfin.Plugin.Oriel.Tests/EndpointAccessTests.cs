using System;
using System.Linq;
using System.Reflection;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public class EndpointAccessTests
{
    // Every route Oriel adds, as Controller.Action.
    private static readonly string[] _actions = typeof(Plugin).Assembly.GetTypes()
        .Where(type => typeof(ControllerBase).IsAssignableFrom(type) && !type.IsAbstract)
        .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(method => method.GetCustomAttributes<HttpMethodAttribute>().Any())
            .Select(method => $"{type.Name}.{method.Name}"))
        .ToArray();

    [Fact]
    public void OnlyTheReaderPageAndItsFilesAreOpenToAnyone()
    {
        Assert.NotEmpty(_actions);
        var anonymous = _actions.Where(name => Method(name).GetCustomAttribute<AllowAnonymousAttribute>() is not null).Order();

        Assert.Equal(["ReaderAssetsController.GetAsset", "ReaderAssetsController.GetReader"], anonymous);
    }

    [Fact]
    public void EveryOtherRouteNeedsASignedInCaller()
    {
        var unguarded = _actions.Where(name =>
        {
            var method = Method(name);
            return method.GetCustomAttribute<AllowAnonymousAttribute>() is null
                && method.GetCustomAttribute<AuthorizeAttribute>() is null
                && method.DeclaringType!.GetCustomAttribute<AuthorizeAttribute>() is null;
        });

        Assert.Empty(unguarded);
    }

    [Theory]
    [InlineData("#a0B1c2", true)]
    [InlineData("#ffffff\n", false)]
    [InlineData("#fff", false)]
    [InlineData("#ffffff;}", false)]
    [InlineData("red", false)]
    public void AColourIsExactlyAHashAndSixHexDigits(string colour, bool accepted) =>
        Assert.Equal(accepted, ReadingRules.IsColour(colour));

    private static MethodInfo Method(string name)
    {
        var (controller, action) = (name[..name.IndexOf('.', StringComparison.Ordinal)], name[(name.IndexOf('.', StringComparison.Ordinal) + 1)..]);
        return typeof(Plugin).Assembly.GetTypes().Single(type => type.Name == controller)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Single(method => method.Name == action);
    }
}
