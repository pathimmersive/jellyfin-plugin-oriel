using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Integration;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public class ReaderHeadersMiddlewareTests
{
    // Runs the response's OnStarting callbacks when the response starts, as a real server does.
    private sealed class StartingFeature : HttpResponseFeature
    {
        private readonly List<(Func<object, Task> Callback, object State)> _starting = [];

        public override void OnStarting(Func<object, Task> callback, object state) => _starting.Add((callback, state));

        public async Task StartAsync()
        {
            for (var i = _starting.Count - 1; i >= 0; i--)
            {
                await _starting[i].Callback(_starting[i].State);
            }
        }
    }

    private static async Task<HttpResponse> Serve(string path, string baseUrl = "", RequestDelegate? next = null)
    {
        var context = new DefaultHttpContext();
        var feature = new StartingFeature { Body = new MemoryStream() };
        context.Features.Set<IHttpResponseFeature>(feature);
        context.Request.Method = "GET";
        context.Request.Path = path;

        await new ReaderHeadersMiddleware(next ?? (_ => Task.CompletedTask), () => baseUrl).InvokeAsync(context);
        await feature.StartAsync();

        return context.Response;
    }

    [Theory]
    [InlineData("/Oriel/", "")]
    [InlineData("/Oriel", "")]
    [InlineData("/Oriel/data.html", "")]
    [InlineData("/Oriel/assets/index-BKl9bpSw.js", "")]
    [InlineData("/Oriel/Positions/3d180653ee958ef40e0ea24db3142dea", "")]
    [InlineData("/oriel/Highlights/3d180653ee958ef40e0ea24db3142dea", "")]
    [InlineData("/jf/Oriel/", "/jf")]
    [InlineData("/JF/Oriel/Fonts", "jf/")]
    public async Task EveryOrielResponseCarriesThePolicy(string path, string baseUrl)
    {
        var response = await Serve(path, baseUrl);

        Assert.Equal(ReaderHeadersMiddleware.ContentSecurityPolicy, response.Headers.ContentSecurityPolicy.ToString());
        Assert.Equal("nosniff", response.Headers.XContentTypeOptions.ToString());
        Assert.Equal("same-origin", response.Headers["Referrer-Policy"].ToString());
    }

    [Theory]
    [InlineData("/web/", "")]
    [InlineData("/web/index.html", "")]
    [InlineData("/Items/3d180653ee958ef40e0ea24db3142dea/Download", "")]
    [InlineData("/OrielOther/", "")]
    [InlineData("/Oriel/", "/jf")]
    [InlineData("/jf/web/", "/jf")]
    public async Task NothingElseIsTouched(string path, string baseUrl)
    {
        var response = await Serve(path, baseUrl);

        Assert.False(response.Headers.ContainsKey("Content-Security-Policy"));
        Assert.False(response.Headers.ContainsKey("Referrer-Policy"));
    }

    [Fact]
    public async Task AnErrorAndARedirectCarryItToo()
    {
        var error = await Serve("/Oriel/Bookmarks/x", next: c =>
        {
            c.Response.StatusCode = StatusCodes.Status500InternalServerError;
            return Task.CompletedTask;
        });
        var moved = await Serve("/Oriel", next: c =>
        {
            c.Response.Redirect("/Oriel/");
            return Task.CompletedTask;
        });

        Assert.Equal(ReaderHeadersMiddleware.ContentSecurityPolicy, error.Headers.ContentSecurityPolicy.ToString());
        Assert.Equal(ReaderHeadersMiddleware.ContentSecurityPolicy, moved.Headers.ContentSecurityPolicy.ToString());
    }

    [Fact]
    public void ThePolicyAllowsScriptsOnlyFromOrielsOwnFiles()
    {
        var policy = ReaderHeadersMiddleware.ContentSecurityPolicy;

        Assert.Contains("script-src 'self';", policy);
        Assert.Contains("object-src 'none'", policy);
        Assert.Contains("base-uri 'none'", policy);
        Assert.DoesNotContain("unsafe-eval", policy);
        Assert.DoesNotContain("script-src 'self' 'unsafe-inline'", policy);
        Assert.DoesNotContain("*", policy);
    }

    [Fact]
    public async Task TheStartupFilterAddsItAheadOfTheRestOfThePipeline()
    {
        var app = new ApplicationBuilder(new ServiceCollection().AddLogging().AddSingleton(WebPageMiddlewareTests.Configuration.WithBaseUrl(string.Empty)).BuildServiceProvider());
        new WebPageStartupFilter().Configure(rest => rest.Run(_ => Task.CompletedTask))(app);

        var context = new DefaultHttpContext { RequestServices = app.ApplicationServices };
        var feature = new StartingFeature { Body = new MemoryStream() };
        context.Features.Set<IHttpResponseFeature>(feature);
        context.Request.Method = "GET";
        context.Request.Path = "/Oriel/";
        await app.Build()(context);
        await feature.StartAsync();

        Assert.Equal(ReaderHeadersMiddleware.ContentSecurityPolicy, context.Response.Headers.ContentSecurityPolicy.ToString());
    }
}
