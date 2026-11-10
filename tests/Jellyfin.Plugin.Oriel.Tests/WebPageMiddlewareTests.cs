using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Integration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Configuration;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Net.Http.Headers;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public class WebPageMiddlewareTests
{
    private const string Index = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body></body></html>";
    private const string Config = "{\n  \"plugins\": [\n    \"bookPlayer/plugin\",\n    \"pdfPlayer/plugin\"\n  ]\n}";
    private const string Tag = "<script src=\"../Oriel/integration/launcher.js\"></script>";
    private const string StockTag = "\"stock\"";

    // Stands in for Jellyfin's static files: honours the validators, compression and
    // HEAD the way the real pipeline does, so the middleware has to undo each one.
    private static Task StaticFiles(HttpContext context)
    {
        var request = context.Request;
        var response = context.Response;
        var config = request.Path.Value!.EndsWith("config.json", StringComparison.OrdinalIgnoreCase);
        response.ContentType = config ? "application/json" : "text/html";
        response.Headers.ETag = StockTag;
        response.Headers.LastModified = "Wed, 01 Jan 2026 00:00:00 GMT";
        if (request.Headers.IfNoneMatch == StockTag || request.Headers.ContainsKey(HeaderNames.IfModifiedSince))
        {
            response.StatusCode = StatusCodes.Status304NotModified;
            return Task.CompletedTask;
        }

        var bytes = Encoding.UTF8.GetBytes(config ? Config : Index);
        if (request.Headers.AcceptEncoding.ToString().Contains("gzip", StringComparison.Ordinal))
        {
            using var zipped = new MemoryStream();
            using (var gzip = new GZipStream(zipped, CompressionLevel.Fastest, leaveOpen: true))
            {
                gzip.Write(bytes);
            }

            bytes = zipped.ToArray();
            response.Headers.ContentEncoding = "gzip";
        }

        response.ContentLength = bytes.Length;
        return HttpMethods.IsHead(request.Method) ? Task.CompletedTask : response.Body.WriteAsync(bytes).AsTask();
    }

    private static async Task<(HttpContext Context, string Body)> Serve(
        string path,
        string method = "GET",
        Action<HttpRequest>? setUp = null,
        RequestDelegate? next = null,
        bool enabled = true,
        string baseUrl = "",
        Func<WebPageMiddleware.WebFile, string, string?>? change = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        setUp?.Invoke(context.Request);
        var body = new MemoryStream();
        context.Response.Body = body;

        await new WebPageMiddleware(next ?? StaticFiles, NullLogger<WebPageMiddleware>.Instance, () => enabled, () => baseUrl, change ?? WebPageMiddleware.Patch).InvokeAsync(context);

        return (context, Encoding.UTF8.GetString(body.ToArray()));
    }

    [Theory]
    [InlineData("/web/index.html", "")]
    [InlineData("/web/", "")]
    [InlineData("/web", "")]
    [InlineData("/jf/web/index.html", "/jf")]
    [InlineData("/JF/Web", "jf/")]
    public async Task TheIndexPageGetsOneLauncherTagUnderItsBaseUrl(string path, string baseUrl)
    {
        var (context, body) = await Serve(path, baseUrl: baseUrl);

        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
        Assert.Equal(Index.Replace("</head>", Tag + "</head>", StringComparison.Ordinal), body);
        Assert.Equal(Encoding.UTF8.GetByteCount(body), context.Response.ContentLength);
    }

    [Theory]
    [InlineData("/web/config.json", "")]
    [InlineData("/jf/web/config.json", "/jf")]
    public async Task ConfigListsThePlayerAfterTheStockPlugins(string path, string baseUrl)
    {
        var (context, body) = await Serve(path, baseUrl: baseUrl);

        Assert.Contains("\"bookPlayer/plugin\"", body);
        Assert.Contains("\"pdfPlayer/plugin\"", body);
        Assert.True(body.IndexOf("\"OrielBookPlayer\"", StringComparison.Ordinal) > body.IndexOf("\"pdfPlayer/plugin\"", StringComparison.Ordinal));
        Assert.Equal(Encoding.UTF8.GetByteCount(body), context.Response.ContentLength);
    }

    [Theory]
    [InlineData("/web/index.html")]
    [InlineData("/web/config.json")]
    public async Task WithTheIntegrationOffBothFilesAreServedAsShipped(string path)
    {
        var (context, body) = await Serve(path, setUp: r => r.Headers.AcceptEncoding = "gzip", enabled: false);

        Assert.Equal(StockTag, context.Response.Headers.ETag.ToString());
        Assert.Equal("gzip", context.Response.Headers.ContentEncoding.ToString());
        Assert.DoesNotContain("Oriel", body);
    }

    [Fact]
    public async Task SwitchingTheIntegrationTakesEffectOnTheNextRequest()
    {
        var on = true;
        async Task<string> Next()
        {
            var context = new DefaultHttpContext();
            context.Request.Method = "GET";
            context.Request.Path = "/web/";
            var body = new MemoryStream();
            context.Response.Body = body;
            await new WebPageMiddleware(StaticFiles, NullLogger<WebPageMiddleware>.Instance, () => on, () => string.Empty, WebPageMiddleware.Patch).InvokeAsync(context);
            return Encoding.UTF8.GetString(body.ToArray());
        }

        Assert.Contains(Tag, await Next());
        on = false;
        Assert.Equal(Index, await Next());
        on = true;
        Assert.Contains(Tag, await Next());
    }

    [Theory]
    [InlineData("/web/main.jellyfin.bundle.js", "")]
    [InlineData("/Users/Me", "")]
    [InlineData("/Oriel/integration/launcher.js", "")]
    [InlineData("/Persons/web", "")]
    [InlineData("/web/", "/jf")]
    [InlineData("/jf/web/config.json", "")]
    public async Task OtherRequestsPassThroughUnchanged(string path, string baseUrl)
    {
        var (context, body) = await Serve(path, baseUrl: baseUrl);

        Assert.Equal(StockTag, context.Response.Headers.ETag.ToString());
        Assert.DoesNotContain("Oriel", body);
    }

    [Fact]
    public async Task AClientThatAcceptsCompressionGetsThePlainChangedFile()
    {
        var (context, body) = await Serve("/web/index.html", setUp: r => r.Headers.AcceptEncoding = "gzip, br");

        Assert.False(context.Response.Headers.ContainsKey(HeaderNames.ContentEncoding));
        Assert.Contains(Tag + "</head>", body);
    }

    [Theory]
    [InlineData("/web/index.html")]
    [InlineData("/web/config.json")]
    public async Task HeadAnswersWithTheHeadersOfGetAndNoBody(string path)
    {
        var (get, _) = await Serve(path);
        var (head, body) = await Serve(path, "HEAD");

        Assert.Equal(string.Empty, body);
        Assert.Equal(StatusCodes.Status200OK, head.Response.StatusCode);
        Assert.Equal(get.Response.ContentLength, head.Response.ContentLength);
        Assert.Equal(get.Response.Headers.ETag.ToString(), head.Response.Headers.ETag.ToString());
        Assert.Equal("HEAD", head.Request.Method);
    }

    [Fact]
    public async Task TheETagDescribesTheChangedFileAndItsValidatorGets304()
    {
        var (first, body) = await Serve("/web/config.json");
        var etag = first.Response.Headers.ETag.ToString();

        Assert.Equal(WebPageMiddleware.ETagOf(Encoding.UTF8.GetBytes(body)), etag);
        Assert.NotEqual(StockTag, etag);
        Assert.False(first.Response.Headers.ContainsKey(HeaderNames.LastModified));

        var (again, empty) = await Serve("/web/config.json", setUp: r => r.Headers.IfNoneMatch = etag);
        Assert.Equal(StatusCodes.Status304NotModified, again.Response.StatusCode);
        Assert.Equal(string.Empty, empty);
    }

    [Fact]
    public async Task TheStockFilesValidatorsAndRangeNeverHideTheChange()
    {
        // A client that cached the page before the integration was on, or asks for part of it.
        var (context, body) = await Serve("/web/index.html", setUp: r =>
        {
            r.Headers.IfNoneMatch = StockTag;
            r.Headers.IfModifiedSince = "Wed, 01 Jan 2026 00:00:00 GMT";
            r.Headers.Range = "bytes=0-10";
        });

        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
        Assert.Contains(Tag, body);
    }

    [Fact]
    public async Task AFileAlreadyCarryingTheChangeIsLeftAsItIs()
    {
        // As when File Transformation, kept for another plugin, has already served it changed.
        var changed = Index.Replace("</head>", Tag + "</head>", StringComparison.Ordinal);
        var (_, body) = await Serve("/web/", next: async c =>
        {
            c.Response.ContentType = "text/html";
            await c.Response.WriteAsync(changed);
        });

        Assert.Equal(changed, body);
    }

    [Fact]
    public async Task AnAnswerOfAnotherTypeANonOkAnswerAndACompressedOneArePassedOnAsTheyCame()
    {
        var (json, jsonBody) = await Serve("/web/", next: async c =>
        {
            c.Response.ContentType = "application/json";
            c.Response.Headers.ETag = StockTag;
            await c.Response.WriteAsync("{\"note\":\"</head>\"}");
        });
        Assert.Equal(StockTag, json.Response.Headers.ETag.ToString());
        Assert.Equal("{\"note\":\"</head>\"}", jsonBody);

        var (moved, _) = await Serve("/web", next: c =>
        {
            c.Response.StatusCode = StatusCodes.Status302Found;
            c.Response.Headers.Location = "/web/";
            return Task.CompletedTask;
        });
        Assert.Equal(StatusCodes.Status302Found, moved.Response.StatusCode);

        var (compressed, compressedBody) = await Serve("/web/config.json", next: async c =>
        {
            c.Response.ContentType = "application/json";
            c.Response.Headers.ContentEncoding = "br";
            await c.Response.WriteAsync("compressed bytes");
        });
        Assert.Equal("compressed bytes", compressedBody);
        Assert.False(compressed.Response.Headers.ContainsKey(HeaderNames.ETag));
    }

    [Fact]
    public async Task AChangeThatFailsServesTheStockFile()
    {
        var (context, body) = await Serve("/web/index.html", change: (_, _) => throw new InvalidOperationException("broken"));

        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
        Assert.Equal(Index, body);
        Assert.Equal(Encoding.UTF8.GetByteCount(Index), context.Response.ContentLength);
    }

    [Fact]
    public async Task TheStartupFilterPutsTheMiddlewareAheadOfTheRestOfThePipeline()
    {
        var app = new ApplicationBuilder(new ServiceCollection().AddLogging().AddSingleton(Configuration.WithBaseUrl(string.Empty)).BuildServiceProvider());
        var plugin = Plugin.Instance;

        new WebPageStartupFilter().Configure(rest => rest.Run(StaticFiles))(app);

        var context = new DefaultHttpContext { RequestServices = app.ApplicationServices };
        context.Request.Method = "GET";
        context.Request.Path = "/web/config.json";
        var body = new MemoryStream();
        context.Response.Body = body;
        await app.Build()(context);

        // Without a running plugin there is no configuration, so the integration counts as off.
        var served = Encoding.UTF8.GetString(body.ToArray());
        Assert.Equal(plugin?.Configuration.EnableWebIntegration == true, served.Contains("OrielBookPlayer", StringComparison.Ordinal));
        Assert.Contains("\"bookPlayer/plugin\"", served);
    }

    // Stands in for Jellyfin's configuration manager: answers only the network configuration.
    public class Configuration : DispatchProxy
    {
        private string _baseUrl = string.Empty;

        public static IServerConfigurationManager WithBaseUrl(string baseUrl)
        {
            var manager = Create<IServerConfigurationManager, Configuration>();
            ((Configuration)(object)manager)._baseUrl = baseUrl;
            return manager;
        }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == "GetConfiguration" && args?[0] as string == "network")
            {
                return new NetworkConfiguration { BaseUrl = _baseUrl };
            }

            throw new NotSupportedException(targetMethod?.Name);
        }
    }
}
