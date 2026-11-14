using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Configuration;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class ReadingDataTests : IDisposable
{
    private const string Cfi = "epubcfi(/6/8!/4/2/1:0)";
    private const string OtherCfi = "epubcfi(/6/10!/4/2/1:0)";

    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 10, 27, 12, 0, 0, TimeSpan.Zero);
    private static readonly BookInfo Dune = new(Guid.NewGuid(), "Dune", ["Frank Herbert"], "dune.epub");
    private static readonly BookInfo Emma = new(Guid.NewGuid(), "Emma", ["Jane Austen"], "emma.epub");
    private static readonly BookInfo Hidden = new(Guid.NewGuid(), "Hidden", ["Nobody"], "hidden.epub");

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-data-" + Guid.NewGuid().ToString("N"));
    private readonly StoreSet _store;
    private readonly PluginConfiguration _configuration = new() { EnableFontUploads = true };

    public ReadingDataTests()
    {
        _store = new StoreSet(Path.Combine(_folder, "oriel.db"));
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    [Fact]
    public void ExportsTheUsersOwnPositionsInBooksTheyCanSee()
    {
        _store.Positions.Save(Reader, Dune.ItemId, new StoredPosition(Cfi, 0.6, Now));
        _store.Positions.Save(Reader, Hidden.ItemId, new StoredPosition(Cfi, 0.2, Now));
        _store.Positions.Save(OtherReader, Emma.ItemId, new StoredPosition(OtherCfi, 0.3, Now));

        var file = Data(Dune, Emma).Export(Reader, Now.AddHours(1));

        Assert.Equal(ReadingData.Format, file.Format);
        Assert.Equal(ReadingData.Version, file.Version);
        Assert.Equal(Now.AddHours(1), file.ExportedAt);
        var entry = Assert.Single(file.Positions!);
        Assert.Equal(new ExportedPosition(Dune.ItemId.ToString("N"), "Dune", Dune.Authors, "dune.epub", Cfi, 0.6, Now), entry);
    }

    [Fact]
    public void AnExportedFileReadsBackUnchanged()
    {
        _store.Positions.Save(Reader, Dune.ItemId, new StoredPosition(Cfi, 0.6, Now.AddTicks(1234567)));
        var file = Data(Dune).Export(Reader, Now);

        var parsed = ReadingData.Parse(ReadingData.Serialize(file));

        Assert.NotNull(parsed);
        var (written, read) = (file.Positions!.Single()!, parsed.Positions!.Single()!);
        Assert.Equal(written.Authors, read.Authors);
        Assert.Equal(written with { Authors = null }, read with { Authors = null });
    }

    public static TheoryData<string, string> RejectedFiles => new()
    {
        { "not JSON", "{\"format\": \"oriel-reading-data\", \"positions\": [" },
        { "another format", "{\"format\": \"something-else\", \"version\": 1, \"positions\": []}" },
        { "no format", "{\"version\": 1, \"positions\": []}" },
        { "a newer version", "{\"format\": \"oriel-reading-data\", \"version\": 7, \"positions\": []}" },
        { "version 0", "{\"format\": \"oriel-reading-data\", \"version\": 0, \"positions\": []}" },
        { "a version that is not a number", "{\"format\": \"oriel-reading-data\", \"version\": \"1\", \"positions\": []}" },
        { "no positions", "{\"format\": \"oriel-reading-data\", \"version\": 1}" },
        { "a null position", File("null") },
        { "a position without a CFI", File("{\"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "an empty CFI", File("{\"cfi\": \"\", \"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a CFI that is too long", File($"{{\"cfi\": \"{new string('a', ReadingRules.MaxCfiLength + 1)}\", \"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}}") },
        { "a fraction above 1", File("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 1.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a fraction below 0", File("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": -0.1, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "no fraction", File("{\"cfi\": \"epubcfi(/6/2)\", \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "no saved time", File("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5}") },
        { "a saved time that is not a time", File("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"savedAt\": \"yesterday\"}") },
        { "an item id that is not an id", File("{\"itemId\": \"abc\", \"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a null author", File("{\"authors\": [null], \"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a null bookmark", WithBookmark("null") },
        { "a bookmark without a CFI", WithBookmark("{\"fraction\": 0.5, \"text\": \"Page\", \"createdAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a bookmark without text", WithBookmark("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"createdAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a bookmark's text that is too long", WithBookmark($"{{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"text\": \"{new string('a', ReadingRules.MaxBookmarkTextLength + 1)}\", \"createdAt\": \"2026-10-27T12:00:00Z\"}}") },
        { "a bookmark's fraction above 1", WithBookmark("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 1.5, \"text\": \"Page\", \"createdAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a bookmark without a time", WithBookmark("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"text\": \"Page\"}") },
        { "a null highlight", WithHighlight("null") },
        { "a highlight without a CFI", WithHighlight("{\"fraction\": 0.5, \"colour\": \"yellow\", \"text\": \"Words\", \"createdAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a highlight without a colour", WithHighlight("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"text\": \"Words\", \"createdAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a highlight with an empty colour", WithHighlight("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"colour\": \"\", \"text\": \"Words\", \"createdAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a highlight's text that is too long", WithHighlight($"{{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"colour\": \"yellow\", \"text\": \"{new string('a', ReadingRules.MaxHighlightTextLength + 1)}\", \"createdAt\": \"2026-10-27T12:00:00Z\"}}") },
        { "a highlight's note that is too long", WithHighlight($"{{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"colour\": \"yellow\", \"text\": \"Words\", \"note\": \"{new string('a', ReadingRules.MaxNoteLength + 1)}\", \"createdAt\": \"2026-10-27T12:00:00Z\"}}") },
        { "a null highlighter", WithHighlighter("null") },
        { "a highlighter without an id", WithHighlighter("{\"name\": \"Questions\", \"colour\": \"#b39ddb\"}") },
        { "a highlighter without a name", WithHighlighter("{\"id\": \"q\", \"name\": \" \", \"colour\": \"#b39ddb\"}") },
        { "a highlighter's colour that is not #rrggbb", WithHighlighter("{\"id\": \"q\", \"name\": \"Questions\", \"colour\": \"lavender\"}") },
        { "a highlight without a time", WithHighlight("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"colour\": \"yellow\", \"text\": \"Words\"}") },
    };

    [Theory]
    [MemberData(nameof(RejectedFiles))]
    public void RejectsAFileThatCannotBeImported(string reason, string json)
    {
        Assert.True(ReadingData.Parse(Encoding.UTF8.GetBytes(json)) is null, reason);
    }

    [Fact]
    public void ExportsAndImportsBookmarksWithoutDuplicatingThem()
    {
        _store.Bookmarks.Add(Reader, Dune.ItemId, Cfi, 0.6, "It begins", Now);
        _store.Bookmarks.Add(Reader, Hidden.ItemId, Cfi, 0.2, "Not exported", Now);
        _store.Bookmarks.Add(OtherReader, Emma.ItemId, OtherCfi, 0.3, "Not mine", Now);
        var file = Data(Dune, Emma).Export(Reader, Now);

        var exported = Assert.Single(file.Bookmarks!);
        Assert.Equal(new ExportedBookmark(Dune.ItemId.ToString("N"), "Dune", Dune.Authors, "dune.epub", Cfi, 0.6, "It begins", Now), exported);

        var parsed = ReadingData.Parse(ReadingData.Serialize(file))!;
        Assert.Equal(0, Data(Dune, Emma).Import(Reader, parsed).Bookmarks);
        Assert.Equal(1, Data(Dune, Emma).Import(OtherReader, parsed).Bookmarks);
        Assert.Single(_store.Bookmarks.List(Reader, Dune.ItemId));
        Assert.Equal("It begins", Assert.Single(_store.Bookmarks.List(OtherReader, Dune.ItemId)).Text);
    }

    [Fact]
    public void ExportsAndImportsHighlightsWithoutDuplicatingThem()
    {
        _store.Highlights.Add(Reader, Dune.ItemId, Cfi, 0.6, "blue", "It begins", Now, "Where it starts.");
        _store.Highlights.Add(Reader, Hidden.ItemId, Cfi, 0.2, "pink", "Not exported", Now);
        _store.Highlights.Add(OtherReader, Emma.ItemId, OtherCfi, 0.3, "green", "Not mine", Now);
        var file = Data(Dune, Emma).Export(Reader, Now);

        var exported = Assert.Single(file.Highlights!);
        Assert.Equal(new ExportedHighlight(Dune.ItemId.ToString("N"), "Dune", Dune.Authors, "dune.epub", Cfi, 0.6, "blue", "It begins", Now, "Where it starts."), exported);

        var parsed = ReadingData.Parse(ReadingData.Serialize(file))!;
        Assert.Equal(0, Data(Dune, Emma).Import(Reader, parsed).Highlights);
        Assert.Equal(1, Data(Dune, Emma).Import(OtherReader, parsed).Highlights);
        Assert.Single(_store.Highlights.List(Reader, Dune.ItemId));
        var theirs = Assert.Single(_store.Highlights.List(OtherReader, Dune.ItemId));
        Assert.Equal(("blue", "It begins", "Where it starts."), (theirs.Colour, theirs.Text, theirs.Note));
    }

    [Fact]
    public void ExportsAndImportsHighlightersAndTheHighlightsInThem()
    {
        var questions = new HighlighterEntry("questions", "Questions", "#b39ddb");
        _store.Highlighters.Replace(Reader, [new("yellow", "Lines", "#ffb74d"), .. ReadingRules.BuiltInHighlighters.Skip(1), questions]);
        _store.Highlights.Add(Reader, Dune.ItemId, Cfi, 0.6, "questions", "It begins", Now);
        var file = Data(Dune).Export(Reader, Now);

        Assert.Equal(
            [new ExportedHighlighter("yellow", "Lines", "#ffb74d"), new ExportedHighlighter("green", "Green", "#81c784"), new ExportedHighlighter("blue", "Vocabulary", "#64b5f6"), new ExportedHighlighter("pink", "Pink", "#f06292"), new ExportedHighlighter("questions", "Questions", "#b39ddb")],
            file.Highlighters!);

        var parsed = ReadingData.Parse(ReadingData.Serialize(file))!;
        var result = Data(Dune).Import(OtherReader, parsed);
        Assert.Equal((1, 1), (result.Highlighters, result.Highlights));
        var theirs = _store.Highlighters.List(OtherReader);
        Assert.Equal(["Quotes", "Green", "Vocabulary", "Pink", "Questions"], theirs.Select(highlighter => highlighter.Name));
        Assert.Equal("questions", Assert.Single(_store.Highlights.List(OtherReader, Dune.ItemId)).Colour);
        Assert.Equal(0, Data(Dune).Import(OtherReader, parsed).Highlighters);
    }

    [Fact]
    public void ImportsAHighlightWhoseHighlighterTheUserDoesNotHaveAsQuotes()
    {
        var file = ReadingData.Parse(Encoding.UTF8.GetBytes(WithHighlight($"{{\"itemId\": \"{Dune.ItemId:N}\", \"cfi\": \"{Cfi}\", \"fraction\": 0.5, \"colour\": \"gone\", \"text\": \"Words\", \"createdAt\": \"2026-10-27T12:00:00Z\"}}")));

        Assert.NotNull(file);
        Assert.Equal(1, Data(Dune).Import(Reader, file).Highlights);
        Assert.Equal("yellow", Assert.Single(_store.Highlights.List(Reader, Dune.ItemId)).Colour);
    }

    [Fact]
    public void ImportsAVersion3FileWhoseHighlightsHaveNoNotes()
    {
        var file = ReadingData.Parse(Encoding.UTF8.GetBytes(WithHighlight($"{{\"itemId\": \"{Dune.ItemId:N}\", \"cfi\": \"{Cfi}\", \"fraction\": 0.5, \"colour\": \"pink\", \"text\": \"Words\", \"createdAt\": \"2026-10-27T12:00:00Z\"}}")));

        Assert.NotNull(file);
        Assert.Equal(1, Data(Dune).Import(Reader, file).Highlights);
        Assert.Equal(string.Empty, Assert.Single(_store.Highlights.List(Reader, Dune.ItemId)).Note);
    }

    [Fact]
    public void ImportsAVersion2FileWithNoHighlights()
    {
        var file = ReadingData.Parse(Encoding.UTF8.GetBytes(WithBookmark($"{{\"itemId\": \"{Dune.ItemId:N}\", \"cfi\": \"{Cfi}\", \"fraction\": 0.5, \"text\": \"Page\", \"createdAt\": \"2026-10-27T12:00:00Z\"}}")));

        Assert.NotNull(file);
        var result = Data(Dune).Import(Reader, file);

        Assert.Equal((1, 0), (result.Bookmarks, result.Highlights));
    }

    [Fact]
    public void ImportsAVersion1FileWithNoBookmarks()
    {
        var file = ReadingData.Parse(Encoding.UTF8.GetBytes(File($"{{\"itemId\": \"{Dune.ItemId:N}\", \"cfi\": \"{Cfi}\", \"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}}")));

        Assert.NotNull(file);
        var result = Data(Dune).Import(Reader, file);

        Assert.Equal((1, 0), (result.Imported, result.Bookmarks));
    }

    [Fact]
    public void ReportsABookOnceWhenNeitherItsPositionNorItsBookmarkMatches()
    {
        var file = new ReadingDataFile(ReadingData.Format, ReadingData.Version, Now, [Entry(Hidden, Cfi, Now)],
            [new ExportedBookmark(Hidden.ItemId.ToString("N"), Hidden.Title, Hidden.Authors, Hidden.FileName, Cfi, 0.2, "Page", Now)]);

        var result = Data(Dune).Import(Reader, file);

        Assert.Single(result.Unmatched);
        Assert.Equal(0, result.Bookmarks);
        Assert.Empty(_store.Bookmarks.List(Reader, Hidden.ItemId));
    }

    [Fact]
    public void KeepsWhicheverPositionWasSavedLast()
    {
        _store.Positions.Save(Reader, Dune.ItemId, new StoredPosition(Cfi, 0.6, Now));
        _store.Positions.Save(Reader, Emma.ItemId, new StoredPosition(Cfi, 0.6, Now));
        var data = Data(Dune, Emma);

        var result = data.Import(Reader, Import(
            Entry(Dune, OtherCfi, Now.AddMinutes(-1)),
            Entry(Emma, OtherCfi, Now.AddMinutes(1))));

        Assert.Equal((1, 1), (result.Imported, result.Kept));
        Assert.Equal(Cfi, _store.Positions.Get(Reader, Dune.ItemId)!.Cfi);
        Assert.Equal(new StoredPosition(OtherCfi, 0.4, Now.AddMinutes(1)), _store.Positions.Get(Reader, Emma.ItemId));
    }

    [Fact]
    public void ImportingTheSameFileTwiceChangesNothing()
    {
        var data = Data(Dune);
        var file = Import(Entry(Dune, Cfi, Now));

        Assert.Equal(1, data.Import(Reader, file).Imported);
        var again = data.Import(Reader, file);

        Assert.Equal((0, 1), (again.Imported, again.Kept));
        Assert.Equal(new StoredPosition(Cfi, 0.4, Now), _store.Positions.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public void ImportsOnlyForTheCaller()
    {
        Data(Dune).Import(Reader, Import(Entry(Dune, Cfi, Now)));

        Assert.Null(_store.Positions.Get(OtherReader, Dune.ItemId));
    }

    [Fact]
    public void MatchesAnUnknownIdByTitleAndAuthorsIgnoringCaseAndOrder()
    {
        var anthology = new BookInfo(Guid.NewGuid(), "Tales", ["B. Writer", "A. Writer"], "tales.epub");
        var entry = Entry(anthology, Cfi, Now) with { ItemId = Guid.NewGuid().ToString(), Title = " tales ", Authors = ["a. writer", "B. WRITER"], FileName = null };

        var result = Data(Dune, anthology).Import(Reader, Import(entry));

        Assert.Equal(1, result.Imported);
        Assert.NotNull(_store.Positions.Get(Reader, anthology.ItemId));
    }

    [Fact]
    public void MatchesByFileNameWhenTitleAndAuthorsDoNot()
    {
        var entry = Entry(Dune, Cfi, Now) with { ItemId = null, Title = "Dune (Special Edition)", FileName = "DUNE.epub" };

        Assert.Equal(1, Data(Dune).Import(Reader, Import(entry)).Imported);
        Assert.NotNull(_store.Positions.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public void ATitleMatchNeedsTheSameAuthors()
    {
        var entry = Entry(Dune, Cfi, Now) with { ItemId = null, Authors = ["Brian Herbert"], FileName = null };

        var result = Data(Dune).Import(Reader, Import(entry));

        Assert.Equal(0, result.Imported);
        Assert.Single(result.Unmatched);
    }

    [Fact]
    public void UsesFileNameWhenTheTitleMatchesMoreThanOneBook()
    {
        var copy = Dune with { ItemId = Guid.NewGuid(), FileName = "dune-copy.epub" };
        var entry = Entry(Dune, Cfi, Now) with { ItemId = null, FileName = "dune-copy.epub" };

        Assert.Equal(1, Data(Dune, copy).Import(Reader, Import(entry)).Imported);
        Assert.NotNull(_store.Positions.Get(Reader, copy.ItemId));
        Assert.Null(_store.Positions.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public void ReportsABookItCannotMatchUnambiguouslyAndGuessesNothing()
    {
        var copy = Dune with { ItemId = Guid.NewGuid() };
        var ambiguous = Entry(Dune, Cfi, Now) with { ItemId = null };
        var missing = new ExportedPosition(Guid.NewGuid().ToString("N"), "Missing", ["Nobody"], "missing.epub", Cfi, 0.1, Now);

        var result = Data(Dune, copy).Import(Reader, Import(ambiguous, missing));

        Assert.Equal((0, 0), (result.Imported, result.Kept));
        Assert.Equal(["Dune", "Missing"], result.Unmatched.Select(book => book.Title));
        Assert.Equal(["Nobody"], result.Unmatched[1].Authors);
        Assert.Null(_store.Positions.Get(Reader, Dune.ItemId));
        Assert.Null(_store.Positions.Get(Reader, copy.ItemId));
    }

    [Fact]
    public void DoesNotImportIntoABookTheUserCannotSee()
    {
        var result = Data(Dune).Import(Reader, Import(Entry(Hidden, Cfi, Now)));

        Assert.Single(result.Unmatched);
        Assert.Null(_store.Positions.Get(Reader, Hidden.ItemId));
    }

    [Fact]
    public async Task ServesTheExportAsADownload()
    {
        _store.Positions.Save(Reader, Dune.ItemId, new StoredPosition(Cfi, 0.6, Now));

        var result = Assert.IsType<FileContentResult>(await Controller(Reader).Export());

        Assert.Equal("oriel-reading-data-2026-10-27.json", result.FileDownloadName);
        Assert.Equal("application/json", result.ContentType);
        Assert.Equal(Cfi, ReadingData.Parse(result.FileContents)!.Positions!.Single()!.Cfi);
    }

    [Fact]
    public async Task ImportsAPostedFile()
    {
        var file = ReadingData.Serialize(Import(Entry(Dune, Cfi, Now)));

        var result = (await Controller(Reader, file).Import()).Value;

        Assert.NotNull(result);
        Assert.Equal((1, 0, 0), (result.Imported, result.Kept, result.Unmatched.Count));
        Assert.NotNull(_store.Positions.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public async Task RejectsAMalformedOrOversizedFileAndStoresNothing()
    {
        var tooLarge = Controller(Reader, ReadingData.Serialize(Import(Entry(Dune, Cfi, Now))));
        tooLarge.HttpContext.Request.ContentLength = ReadingDataController.MaxImportBytes + 1L;

        Assert.Equal("malformed", Refused.Reason((await Controller(Reader, "{\"format\":"u8.ToArray()).Import()).Result));
        Assert.Equal("tooLarge", Refused.Reason((await tooLarge.Import()).Result));
        Assert.Null(_store.Positions.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public void ExportsTheUsersThemesFontsAndChoices()
    {
        var (theme, regular, italic) = SetUp(Reader);

        var file = ReadingData.Parse(ReadingData.Serialize(Data(Dune).Export(Reader, Now)))!;

        Assert.Equal(6, file.Version);
        Assert.Equal([(theme, "Night Blue", "#0f1a2a", "#6c7f96")], file.Themes!.Select(entry => (entry!.Id, entry.Name, entry.Background, entry.Grayed)));
        Assert.Equal(
            [("Atkinson Hyperlegible", 400, false, "woff2", regular.Length), ("Atkinson Hyperlegible", 700, true, "woff2", italic.Length)],
            file.Fonts!.Select(entry => (entry!.Family, entry.Weight!.Value, entry.Italic!.Value, entry.Format, entry.Data!.Length)).OrderBy(entry => entry.Item2));
        Assert.Equal(new ExportedChoices($"own:{theme}", "own:Atkinson Hyperlegible"), file.Choices);
    }

    [Fact]
    public void ImportsThemesFontsAndChoicesOnceForAReaderWithNone()
    {
        var (theme, _, _) = SetUp(Reader);
        var file = ReadingData.Parse(ReadingData.Serialize(Data(Dune).Export(Reader, Now)))!;

        var result = Data(Dune).Import(OtherReader, file);

        Assert.Equal((1, 1, true), (result.Themes, result.Fonts, result.Choices));
        Assert.Equal([theme], _store.Themes.List(OtherReader).Select(entry => entry.Id));
        Assert.Equal(2, _store.Fonts.List(OtherReader).Count);
        Assert.Equal(new StoredChoices($"own:{theme}", "own:Atkinson Hyperlegible"), _store.Choices.Get(OtherReader));

        var again = Data(Dune).Import(OtherReader, file);

        Assert.Equal((0, 0, false), (again.Themes, again.Fonts, again.Choices));
        Assert.Single(_store.Themes.List(OtherReader));
        Assert.Equal(2, _store.Fonts.List(OtherReader).Count);
    }

    [Fact]
    public void ImportsEverythingButFontsWhileUploadsAreOff()
    {
        var (theme, _, _) = SetUp(Reader);
        var file = ReadingData.Parse(ReadingData.Serialize(Data(Dune).Export(Reader, Now)))!;
        _configuration.EnableFontUploads = false;

        var result = Data(Dune).Import(OtherReader, file);

        Assert.Equal((1, 0), (result.Themes, result.Fonts));
        Assert.Equal([theme], _store.Themes.List(OtherReader).Select(entry => entry.Id));
        Assert.Empty(_store.Fonts.List(OtherReader));
        Assert.Equal(2, _store.Fonts.List(Reader).Count);
    }

    [Fact]
    public void KeepsTheChoiceAReaderHasMadeHere()
    {
        SetUp(Reader);
        var file = Data(Dune).Export(Reader, Now);
        _store.Choices.Save(OtherReader, new StoredChoices("sepia", "Literata"));

        var result = Data(Dune).Import(OtherReader, file);

        Assert.False(result.Choices);
        Assert.Equal(new StoredChoices("sepia", "Literata"), _store.Choices.Get(OtherReader));
    }

    [Fact]
    public void AddsThemesOnlyWhileThereIsRoom()
    {
        _store.Themes.Replace(OtherReader, Enumerable.Range(0, ReadingRules.MaxThemes).Select(at => new ThemeEntry($"t{at}", $"Theme {at}", NightBlue)).ToList());
        SetUp(Reader);

        var result = Data(Dune).Import(OtherReader, Data(Dune).Export(Reader, Now));

        Assert.Equal(0, result.Themes);
        Assert.Equal(ReadingRules.MaxThemes, _store.Themes.List(OtherReader).Count);
        Assert.False(result.Choices);
    }

    [Theory]
    [InlineData("a theme with a colour that is not #rrggbb", "\"themes\": [{\"id\": \"a1\", \"name\": \"Night Blue\", \"background\": \"blue\", \"text\": \"#d7dee8\", \"secondary\": \"#9fb0c4\", \"accent\": \"#7cc4ff\", \"selection\": \"#2e5a85\", \"separator\": \"#2b4466\", \"controls\": \"#14243a\", \"controlsText\": \"#e6edf5\", \"buttons\": \"#23395a\", \"grayed\": \"#6c7f96\"}]")]
    [InlineData("a theme with no name", "\"themes\": [{\"id\": \"a1\", \"name\": \" \", \"background\": \"#0f1a2a\", \"text\": \"#d7dee8\", \"secondary\": \"#9fb0c4\", \"accent\": \"#7cc4ff\", \"selection\": \"#2e5a85\", \"separator\": \"#2b4466\", \"controls\": \"#14243a\", \"controlsText\": \"#e6edf5\", \"buttons\": \"#23395a\", \"grayed\": \"#6c7f96\"}]")]
    [InlineData("a font that is not a font", "\"fonts\": [{\"family\": \"X\", \"data\": \"VGhlc2UgYXJlIG5vdGVzLg==\"}]")]
    [InlineData("a font that is not base64", "\"fonts\": [{\"family\": \"X\", \"data\": \"not base64!\"}]")]
    [InlineData("choices without a font", "\"choices\": {\"theme\": \"dark\"}")]
    public void RefusesAFileWithAMalformedThemeFontOrChoice(string what, string field)
    {
        Assert.True(ReadingData.Parse(Encoding.UTF8.GetBytes($"{{\"format\": \"oriel-reading-data\", \"version\": 6, \"positions\": [], {field}}}")) is null, what);
    }

    [Theory]
    [MemberData(nameof(FontsControllerTests.HostileWoff2s), MemberType = typeof(FontsControllerTests))]
    public void RefusesAFileHoldingAHostileWoff2AndStoresNothing(string what)
    {
        var data = Convert.ToBase64String(FontsControllerTests.HostileWoff2(what));

        Assert.True(ReadingData.Parse(Encoding.UTF8.GetBytes($"{{\"format\": \"oriel-reading-data\", \"version\": 6, \"positions\": [], \"fonts\": [{{\"family\": \"X\", \"data\": \"{data}\"}}]}}")) is null, what);
        Assert.Empty(_store.Fonts.List(Reader));
    }

    [Fact]
    public void ImportsAVersion5FileWithTheKindsItHolds()
    {
        var file = ReadingData.Parse(Encoding.UTF8.GetBytes(WithHighlighter("{\"id\": \"h1\", \"name\": \"Ideas\", \"colour\": \"#80cbc4\"}")))!;

        var result = Data(Dune).Import(Reader, file);

        Assert.Equal((1, 0, 0, false), (result.Highlighters, result.Themes, result.Fonts, result.Choices));
        Assert.Null(_store.Choices.Get(Reader));
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        Assert.IsType<UnauthorizedResult>(await Controller(Guid.Empty).Export());
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty, ReadingData.Serialize(Import())).Import()).Result);
    }

    private static readonly IReadOnlyList<string> NightBlue =
        ["#0f1a2a", "#d7dee8", "#9fb0c4", "#7cc4ff", "#2e5a85", "#2b4466", "#14243a", "#e6edf5", "#23395a", "#6c7f96"];

    // A reader with Night Blue, two Atkinson Hyperlegible files and both chosen: the theme's id and the files.
    private (string Theme, byte[] Regular, byte[] Italic) SetUp(Guid reader)
    {
        var theme = _store.Themes.Replace(reader, [new ThemeEntry(Guid.NewGuid().ToString("N"), "Night Blue", NightBlue)])[0].Id;
        var regular = System.IO.File.ReadAllBytes(FontsControllerTests.Fontsource("atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2"));
        var italic = System.IO.File.ReadAllBytes(FontsControllerTests.Fontsource("atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-italic.woff2"));
        _store.Fonts.Add(reader, FontFile.Read(regular)!, regular, Now);
        _store.Fonts.Add(reader, FontFile.Read(italic)!, italic, Now);
        _store.Choices.Save(reader, new StoredChoices($"own:{theme}", "own:Atkinson Hyperlegible"));
        return (theme, regular, italic);
    }

    private static string File(string position) =>
        $"{{\"format\": \"oriel-reading-data\", \"version\": 1, \"positions\": [{position}]}}";

    private static string WithHighlighter(string highlighter) =>
        $"{{\"format\": \"oriel-reading-data\", \"version\": 5, \"positions\": [], \"highlighters\": [{highlighter}]}}";

    private static string WithHighlight(string highlight) =>
        $"{{\"format\": \"oriel-reading-data\", \"version\": 3, \"positions\": [], \"highlights\": [{highlight}]}}";

    private static string WithBookmark(string bookmark) =>
        $"{{\"format\": \"oriel-reading-data\", \"version\": 2, \"positions\": [], \"bookmarks\": [{bookmark}]}}";

    private static ExportedPosition Entry(BookInfo book, string cfi, DateTimeOffset savedAt) =>
        new(book.ItemId.ToString("N"), book.Title, book.Authors, book.FileName, cfi, 0.4, savedAt);

    private static ReadingDataFile Import(params ExportedPosition[] positions) =>
        new(ReadingData.Format, ReadingData.Version, Now, positions);

    private ReadingData Data(params BookInfo[] visible) => new(_store.Database, _store.All, new FakeCatalog(visible), () => _configuration);

    private ReadingDataController Controller(Guid caller, byte[]? body = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(body ?? []);
        return new(Data(Dune, Emma), new FakeAuthorization(caller), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
    }

    private sealed class FakeCatalog(IReadOnlyList<BookInfo> visible) : IBookCatalog
    {
        public BookInfo? Find(Guid userId, Guid itemId) => visible.FirstOrDefault(book => book.ItemId == itemId);

        public IReadOnlyList<BookInfo> Books(Guid userId) => visible;
    }

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

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
