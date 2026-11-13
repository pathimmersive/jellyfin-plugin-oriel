using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Xunit;
using Entry = Jellyfin.Plugin.Oriel.Controllers.HighlightersController.HighlighterRequest;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class HighlightersControllerTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly Guid Book = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 11, 2, 12, 0, 0, TimeSpan.Zero);

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-highlighters-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;

    public HighlightersControllerTests()
    {
        _store = new PositionStore(Path.Combine(_folder, "oriel.db"));
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    // The built-ins as a request sends them back.
    private static List<Entry?> BuiltIns() =>
        [.. PositionStore.BuiltInHighlighters.Select(builtIn => (Entry?)new Entry(builtIn.Id, builtIn.Name, builtIn.Colour))];

    [Fact]
    public async Task ListsTheFourBuiltInsForAReaderWhoHasChangedNothing()
    {
        var listed = (await Controller(Reader).GetHighlighters()).Value!;

        Assert.Equal(
            [("yellow", "Quotes", "#ffd54f", true), ("green", "Green", "#81c784", true), ("blue", "Vocabulary", "#64b5f6", true), ("pink", "Pink", "#f06292", true)],
            listed.Select(highlighter => (highlighter.Id, highlighter.Name, highlighter.Colour, highlighter.BuiltIn)));
    }

    [Fact]
    public async Task AddsEditsAndReordersHighlighters()
    {
        var controller = Controller(Reader);
        var list = BuiltIns();
        list.Insert(1, new Entry(null, "  Questions ", "#B39DDB"));
        list[0] = new Entry("yellow", "Lines", "#ffb74d");

        var saved = (await controller.PutHighlighters(list)).Value!;

        Assert.Equal(["yellow", null, "green", "blue", "pink"], saved.Select(highlighter => highlighter.BuiltIn ? highlighter.Id : null));
        Assert.Equal(("Lines", "#ffb74d"), (saved[0].Name, saved[0].Colour));
        Assert.Equal(("Questions", "#b39ddb", false), (saved[1].Name, saved[1].Colour, saved[1].BuiltIn));
        Assert.Equal(saved, (await controller.GetHighlighters()).Value!);
        Assert.Contains(saved[1].Id, _store.HighlighterIds(Reader));
    }

    [Fact]
    public async Task CountsTheHighlightsInEachAndMovesADeletedOnesHighlightsToQuotes()
    {
        var controller = Controller(Reader);
        var list = BuiltIns();
        list.Add(new Entry(null, "Questions", "#b39ddb"));
        var questions = (await controller.PutHighlighters(list)).Value![4].Id;
        _store.AddHighlight(Reader, Book, "epubcfi(/6/4!/4/2,/1:0,/1:4)", 0.2, questions, "One", Now);
        _store.AddHighlight(Reader, Book, "epubcfi(/6/4!/4/4,/1:0,/1:4)", 0.2, questions, "Two", Now);
        _store.AddHighlight(Reader, Book, "epubcfi(/6/4!/4/6,/1:0,/1:4)", 0.2, "pink", "Three", Now);

        Assert.Equal([0, 0, 0, 1, 2], (await controller.GetHighlighters()).Value!.Select(highlighter => highlighter.Uses));

        var after = (await controller.PutHighlighters(BuiltIns())).Value!;

        Assert.Equal(4, after.Count);
        Assert.Equal(2, after[0].Uses);
        Assert.Equal(["pink", "yellow", "yellow"], _store.ListHighlights(Reader, Book).Select(highlight => highlight.Colour).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task KeepsEachReadersHighlightersApart()
    {
        var list = BuiltIns();
        list.Add(new Entry(null, "Mine", "#4db6ac"));
        var mine = (await Controller(Reader).PutHighlighters(list)).Value![4].Id;

        Assert.Equal(4, (await Controller(OtherReader).GetHighlighters()).Value!.Count);
        var theirs = BuiltIns();
        theirs.Add(new Entry(mine, "Taken", "#4db6ac"));
        Assert.Equal("invalidHighlighters", Refused.Reason((await Controller(OtherReader).PutHighlighters(theirs)).Result));
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty).GetHighlighters()).Result);
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty).PutHighlighters(BuiltIns())).Result);
    }

    public static TheoryData<string> MalformedLists => new()
    {
        "none",
        "three",
        "nine",
        "a built-in missing",
        "a built-in twice",
        "an id the reader does not have",
        "an empty name",
        "a name too long",
        "a colour that is not #rrggbb",
        "a null entry",
    };

    [Theory]
    [MemberData(nameof(MalformedLists))]
    public async Task RejectsAMalformedListAndKeepsTheHighlighters(string reason)
    {
        var list = BuiltIns();
        switch (reason)
        {
            case "none": list = null; break;
            case "three": list.RemoveAt(3); break;
            case "nine": list.AddRange(Enumerable.Range(0, 5).Select(i => (Entry?)new Entry(null, $"Extra {i}", "#a1887f"))); break;
            case "a built-in missing": list[3] = new Entry(null, "Instead", "#a1887f"); break;
            case "a built-in twice": list.Add(new Entry("pink", "Pink again", "#f06292")); break;
            case "an id the reader does not have": list.Add(new Entry("someone-else", "Theirs", "#a1887f")); break;
            case "an empty name": list.Add(new Entry(null, "  ", "#a1887f")); break;
            case "a name too long": list.Add(new Entry(null, new string('a', HighlightersController.MaxNameLength + 1), "#a1887f")); break;
            case "a colour that is not #rrggbb": list.Add(new Entry(null, "Brownish", "brown")); break;
            case "a null entry": list.Add(null); break;
        }

        Assert.Equal("invalidHighlighters", Refused.Reason((await Controller(Reader).PutHighlighters(list)).Result));
        Assert.Equal(4, _store.ListHighlighters(Reader).Count);
    }

    [Fact]
    public async Task AHighlightMayBeInTheReadersOwnHighlighterOnly()
    {
        var list = BuiltIns();
        list.Add(new Entry(null, "Questions", "#b39ddb"));
        var questions = (await Controller(Reader).PutHighlighters(list)).Value![4].Id;
        var highlights = new HighlightsController(_store, new FakeAuthorization(Reader), new FakeItemAccess(), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        var theirs = new HighlightsController(_store, new FakeAuthorization(OtherReader), new FakeItemAccess(), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        Assert.Equal(questions, (await highlights.PostHighlight(Book, new("epubcfi(/6/4!/4/2,/1:0,/1:4)", 0.2, questions, "Text"))).Value!.Colour);
        Assert.Equal("unknownHighlighter", Refused.Reason((await theirs.PostHighlight(Book, new("epubcfi(/6/4!/4/2,/1:0,/1:4)", 0.2, questions, "Text"))).Result));
    }

    private HighlightersController Controller(Guid caller) =>
        new(_store, new FakeAuthorization(caller))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    // AuthorizationInfo.UserId comes from its User; no user means an anonymous caller.
    private sealed class FakeAuthorization(Guid userId) : IAuthorizationContext
    {
        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpContext requestContext) => Task.FromResult(Info());

        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpRequest requestContext) => Task.FromResult(Info());

        private AuthorizationInfo Info() => new()
        {
            User = userId.Equals(Guid.Empty) ? null : new User("reader", "provider", "reset") { Id = userId },
        };
    }

    private sealed class FakeItemAccess : IItemAccess
    {
        public bool CanSee(Guid userId, Guid itemId) => true;
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
