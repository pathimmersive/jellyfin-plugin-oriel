using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// A file of one user's reading data, as exported and imported.
/// </summary>
/// <param name="Format">Always <see cref="ReadingData.Format"/>.</param>
/// <param name="Version">The format version.</param>
/// <param name="ExportedAt">When the file was exported.</param>
/// <param name="Positions">The user's positions, one per book.</param>
/// <param name="Bookmarks">The user's bookmarks, from version 2; none in a version 1 file.</param>
/// <param name="Highlights">The user's highlights, from version 3; none in an earlier file.</param>
/// <param name="Highlighters">The user's highlighters in their order, from version 5; none in an earlier file.</param>
/// <param name="Themes">The user's own themes in their order, from version 6; none in an earlier file.</param>
/// <param name="Fonts">The user's own font files, from version 6; none in an earlier file.</param>
/// <param name="Choices">The theme and font the user has chosen, from version 6; null when none.</param>
public sealed record ReadingDataFile(
    [property: JsonPropertyName("format")] string? Format,
    [property: JsonPropertyName("version")] int? Version,
    [property: JsonPropertyName("exportedAt")] DateTimeOffset? ExportedAt,
    [property: JsonPropertyName("positions")] IReadOnlyList<ExportedPosition?>? Positions,
    [property: JsonPropertyName("bookmarks")] IReadOnlyList<ExportedBookmark?>? Bookmarks = null,
    [property: JsonPropertyName("highlights")] IReadOnlyList<ExportedHighlight?>? Highlights = null,
    [property: JsonPropertyName("highlighters")] IReadOnlyList<ExportedHighlighter?>? Highlighters = null,
    [property: JsonPropertyName("themes")] IReadOnlyList<ExportedTheme?>? Themes = null,
    [property: JsonPropertyName("fonts")] IReadOnlyList<ExportedFont?>? Fonts = null,
    [property: JsonPropertyName("choices")] ExportedChoices? Choices = null);

/// <summary>
/// A position in a file, with what identifies its book on another server.
/// </summary>
/// <param name="ItemId">The book's item id on the server it was exported from.</param>
/// <param name="Title">The book's title.</param>
/// <param name="Authors">The book's authors.</param>
/// <param name="FileName">The book file's name.</param>
/// <param name="Cfi">The EPUB CFI of the position.</param>
/// <param name="Fraction">How far through the book the position is, from 0 to 1.</param>
/// <param name="SavedAt">When the position was saved.</param>
public sealed record ExportedPosition(
    [property: JsonPropertyName("itemId")] string? ItemId,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("authors")] IReadOnlyList<string>? Authors,
    [property: JsonPropertyName("fileName")] string? FileName,
    [property: JsonPropertyName("cfi")] string? Cfi,
    [property: JsonPropertyName("fraction")] double? Fraction,
    [property: JsonPropertyName("savedAt")] DateTimeOffset? SavedAt);

/// <summary>
/// A bookmark in a file, with what identifies its book on another server.
/// </summary>
/// <param name="ItemId">The book's item id on the server it was exported from.</param>
/// <param name="Title">The book's title.</param>
/// <param name="Authors">The book's authors.</param>
/// <param name="FileName">The book file's name.</param>
/// <param name="Cfi">The EPUB CFI of the start of the page.</param>
/// <param name="Fraction">How far through the book the page is, from 0 to 1.</param>
/// <param name="Text">The text the page opens with.</param>
/// <param name="CreatedAt">When the bookmark was made.</param>
public sealed record ExportedBookmark(
    [property: JsonPropertyName("itemId")] string? ItemId,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("authors")] IReadOnlyList<string>? Authors,
    [property: JsonPropertyName("fileName")] string? FileName,
    [property: JsonPropertyName("cfi")] string? Cfi,
    [property: JsonPropertyName("fraction")] double? Fraction,
    [property: JsonPropertyName("text")] string? Text,
    [property: JsonPropertyName("createdAt")] DateTimeOffset? CreatedAt);

/// <summary>
/// A highlight in a file, with what identifies its book on another server.
/// </summary>
/// <param name="ItemId">The book's item id on the server it was exported from.</param>
/// <param name="Title">The book's title.</param>
/// <param name="Authors">The book's authors.</param>
/// <param name="FileName">The book file's name.</param>
/// <param name="Cfi">The EPUB range CFI of the highlighted text.</param>
/// <param name="Fraction">How far through the book the page it was made on is, from 0 to 1.</param>
/// <param name="Colour">Its highlighter's colour.</param>
/// <param name="Text">The highlighted text.</param>
/// <param name="CreatedAt">When the highlight was made.</param>
/// <param name="Note">The reader's note on it, from version 4; empty for none.</param>
public sealed record ExportedHighlight(
    [property: JsonPropertyName("itemId")] string? ItemId,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("authors")] IReadOnlyList<string>? Authors,
    [property: JsonPropertyName("fileName")] string? FileName,
    [property: JsonPropertyName("cfi")] string? Cfi,
    [property: JsonPropertyName("fraction")] double? Fraction,
    [property: JsonPropertyName("colour")] string? Colour,
    [property: JsonPropertyName("text")] string? Text,
    [property: JsonPropertyName("createdAt")] DateTimeOffset? CreatedAt,
    [property: JsonPropertyName("note")] string? Note = null);

/// <summary>
/// A highlighter in a file.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Name">Its name.</param>
/// <param name="Colour">Its colour, as #rrggbb.</param>
public sealed record ExportedHighlighter(
    [property: JsonPropertyName("id")] string? Id,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("colour")] string? Colour);

/// <summary>
/// One of the user's own themes in a file, with the fields <c>/Oriel/Themes</c> uses.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Name">Its name.</param>
/// <param name="Background">The page.</param>
/// <param name="Text">The book's text.</param>
/// <param name="Secondary">Chapter names, progress and labels.</param>
/// <param name="Accent">Selected items, links and the slider.</param>
/// <param name="Selection">Selected text.</param>
/// <param name="Separator">Lines between rows.</param>
/// <param name="Controls">The header, footer and panels.</param>
/// <param name="ControlsText">Text and icons in the controls.</param>
/// <param name="Buttons">Buttons in the controls.</param>
/// <param name="Grayed">Unavailable items.</param>
public sealed record ExportedTheme(
    [property: JsonPropertyName("id")] string? Id,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("background")] string? Background,
    [property: JsonPropertyName("text")] string? Text,
    [property: JsonPropertyName("secondary")] string? Secondary,
    [property: JsonPropertyName("accent")] string? Accent,
    [property: JsonPropertyName("selection")] string? Selection,
    [property: JsonPropertyName("separator")] string? Separator,
    [property: JsonPropertyName("controls")] string? Controls,
    [property: JsonPropertyName("controlsText")] string? ControlsText,
    [property: JsonPropertyName("buttons")] string? Buttons,
    [property: JsonPropertyName("grayed")] string? Grayed)
{
    /// <summary>
    /// The colours, in the order the store keeps them.
    /// </summary>
    /// <returns>The ten colours as the file gives them.</returns>
    public IReadOnlyList<string?> Colours() =>
        [Background, Text, Secondary, Accent, Selection, Separator, Controls, ControlsText, Buttons, Grayed];
}

/// <summary>
/// One of the user's own font files in a file. The names and style are for reading; an import reads them again from the bytes.
/// </summary>
/// <param name="Family">Its family.</param>
/// <param name="Style">Its style name.</param>
/// <param name="Weight">Its weight class.</param>
/// <param name="Italic">True for an italic face.</param>
/// <param name="Format">ttf, otf or woff2.</param>
/// <param name="Data">The file's bytes, as base64.</param>
public sealed record ExportedFont(
    [property: JsonPropertyName("family")] string? Family,
    [property: JsonPropertyName("style")] string? Style,
    [property: JsonPropertyName("weight")] int? Weight,
    [property: JsonPropertyName("italic")] bool? Italic,
    [property: JsonPropertyName("format")] string? Format,
    [property: JsonPropertyName("data")] byte[]? Data);

/// <summary>
/// The theme and font the user has chosen, in a file.
/// </summary>
/// <param name="Theme">The theme, as <c>/Oriel/Choices</c> names it.</param>
/// <param name="Font">The font, as <c>/Oriel/Choices</c> names it.</param>
public sealed record ExportedChoices(
    [property: JsonPropertyName("theme")] string? Theme,
    [property: JsonPropertyName("font")] string? Font);

/// <summary>
/// A book in an imported file that matched no book the user can see.
/// </summary>
/// <param name="Title">The book's title as the file gives it.</param>
/// <param name="Authors">The book's authors as the file gives them.</param>
/// <param name="FileName">The book file's name as the file gives it.</param>
public sealed record UnmatchedBook(
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("authors")] IReadOnlyList<string> Authors,
    [property: JsonPropertyName("fileName")] string? FileName);

/// <summary>
/// What an import did.
/// </summary>
/// <param name="Imported">Positions stored because they were newer than the server's, or the server had none.</param>
/// <param name="Kept">Positions not stored because the server's was as new or newer.</param>
/// <param name="Unmatched">Books that matched no book the user can see.</param>
/// <param name="Bookmarks">Bookmarks added because the user had none at the same place.</param>
/// <param name="Highlights">Highlights added because the user had none at the same place.</param>
/// <param name="Highlighters">Highlighters added because the user did not have them.</param>
/// <param name="Themes">Themes added because the user did not have them.</param>
/// <param name="Fonts">Font families that gained a file the user did not have.</param>
/// <param name="Choices">True when the file's chosen theme and font were taken, the user having chosen none here.</param>
/// <param name="Limited">The limits the import reached, bookmarks or highlights, past which its entries were left out.</param>
public sealed record ImportResult(
    [property: JsonPropertyName("imported")] int Imported,
    [property: JsonPropertyName("kept")] int Kept,
    [property: JsonPropertyName("unmatched")] IReadOnlyList<UnmatchedBook> Unmatched,
    [property: JsonPropertyName("bookmarks")] int Bookmarks = 0,
    [property: JsonPropertyName("highlights")] int Highlights = 0,
    [property: JsonPropertyName("highlighters")] int Highlighters = 0,
    [property: JsonPropertyName("themes")] int Themes = 0,
    [property: JsonPropertyName("fonts")] int Fonts = 0,
    [property: JsonPropertyName("choices")] bool Choices = false,
    [property: JsonPropertyName("limited")] IReadOnlyList<string>? Limited = null);

/// <summary>
/// Exports a user's reading data to a file and imports it back, here or on another server.
/// </summary>
public class ReadingData
{
    /// <summary>
    /// The format name every file carries.
    /// </summary>
    public const string Format = "oriel-reading-data";

    /// <summary>
    /// The newest format version this plugin reads and the one it writes.
    /// </summary>
    public const int Version = 6;

    /// <summary>
    /// The longest CFI accepted, as when the reader saves a position.
    /// </summary>
    public const int MaxCfiLength = Controllers.PositionsController.MaxCfiLength;

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    private readonly PositionStore _store;
    private readonly IBookCatalog _catalog;
    private readonly Func<Configuration.PluginConfiguration?> _configuration;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, bool> _importing = new();

    /// <summary>
    /// Initializes a new instance of the <see cref="ReadingData"/> class.
    /// </summary>
    /// <param name="store">The position store.</param>
    /// <param name="catalog">The books each user can see.</param>
    public ReadingData(PositionStore store, IBookCatalog catalog)
        : this(store, catalog, () => Plugin.Instance?.Configuration)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="ReadingData"/> class with a given configuration.
    /// </summary>
    /// <param name="store">The position store.</param>
    /// <param name="catalog">The books each user can see.</param>
    /// <param name="configuration">The plugin's settings as they are now.</param>
    public ReadingData(PositionStore store, IBookCatalog catalog, Func<Configuration.PluginConfiguration?> configuration)
    {
        _store = store;
        _catalog = catalog;
        _configuration = configuration;
    }

    /// <summary>
    /// Builds a user's file: each stored position, bookmark and highlight in a book the user can still see,
    /// their highlighters, themes and fonts, and the theme and font they have chosen.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="now">The export time.</param>
    /// <returns>The file.</returns>
    public ReadingDataFile Export(Guid userId, DateTimeOffset now)
    {
        var positions = new List<ExportedPosition?>();
        foreach (var (itemId, position) in _store.ListForUser(userId))
        {
            if (_catalog.Find(userId, itemId) is { } book)
            {
                positions.Add(new ExportedPosition(
                    itemId.ToString("N"), book.Title, book.Authors, book.FileName, position.Cfi, position.Fraction, position.SavedAt));
            }
        }

        var bookmarks = new List<ExportedBookmark?>();
        foreach (var (itemId, bookmark) in _store.ListBookmarksForUser(userId))
        {
            if (_catalog.Find(userId, itemId) is { } book)
            {
                bookmarks.Add(new ExportedBookmark(
                    itemId.ToString("N"), book.Title, book.Authors, book.FileName, bookmark.Cfi, bookmark.Fraction, bookmark.Text, bookmark.CreatedAt));
            }
        }

        var highlights = new List<ExportedHighlight?>();
        foreach (var (itemId, highlight) in _store.ListHighlightsForUser(userId))
        {
            if (_catalog.Find(userId, itemId) is { } book)
            {
                highlights.Add(new ExportedHighlight(
                    itemId.ToString("N"), book.Title, book.Authors, book.FileName, highlight.Cfi, highlight.Fraction, highlight.Colour, highlight.Text, highlight.CreatedAt, highlight.Note));
            }
        }

        var highlighters = _store.ListHighlighters(userId).Select(highlighter => (ExportedHighlighter?)new ExportedHighlighter(highlighter.Id, highlighter.Name, highlighter.Colour)).ToList();
        var themes = _store.ListThemes(userId).Select(theme => (ExportedTheme?)new ExportedTheme(
            theme.Id, theme.Name, theme.Colours[0], theme.Colours[1], theme.Colours[2], theme.Colours[3], theme.Colours[4],
            theme.Colours[5], theme.Colours[6], theme.Colours[7], theme.Colours[8], theme.Colours[9])).ToList();
        var fonts = new List<ExportedFont?>();
        foreach (var stored in _store.ListFonts(userId))
        {
            if (_store.GetFontData(userId, stored.Id) is { } file)
            {
                fonts.Add(new ExportedFont(stored.Font.Family, stored.Font.Style, stored.Font.Weight, stored.Font.Italic, file.Format, file.Data));
            }
        }

        var choices = _store.GetChoices(userId) is { } chosen ? new ExportedChoices(chosen.Theme, chosen.Font) : null;
        return new ReadingDataFile(Format, Version, now, positions, bookmarks, highlights, highlighters, themes, fonts, choices);
    }

    /// <summary>
    /// Writes a file as JSON.
    /// </summary>
    /// <param name="file">The file.</param>
    /// <returns>The UTF-8 JSON.</returns>
    public static byte[] Serialize(ReadingDataFile file) => JsonSerializer.SerializeToUtf8Bytes(file, Json);

    /// <summary>
    /// Reads a file, accepting it only when it is an Oriel file of a version this plugin reads
    /// and every position, bookmark and highlight in it is complete and in range.
    /// </summary>
    /// <param name="json">The UTF-8 JSON.</param>
    /// <returns>The file, or null when it is not one this plugin can import.</returns>
    public static ReadingDataFile? Parse(ReadOnlySpan<byte> json)
    {
        ReadingDataFile? file;
        try
        {
            file = JsonSerializer.Deserialize<ReadingDataFile>(json, Json);
        }
        catch (JsonException)
        {
            return null;
        }

        if (file is not { Format: Format, Version: >= 1 and <= Version, Positions: { } positions })
        {
            return null;
        }

        return positions.All(Valid) && (file.Bookmarks ?? []).All(Valid) && (file.Highlights ?? []).All(Valid) && (file.Highlighters ?? []).All(Valid)
            && (file.Themes ?? []).All(Valid) && (file.Fonts ?? []).All(Valid) && file.Choices is null or { Theme: not null, Font: not null } ? file : null;
    }

    /// <summary>
    /// Imports a file for a user. Each position goes to the book it matches, by item id, else by
    /// title and authors, else by file name, using only a match to exactly one book the user can see.
    /// It replaces the user's position in that book only when it was saved later. Each bookmark goes
    /// and each highlight go to their book the same way, and are added unless the user has one at the same place.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="file">A file accepted by <see cref="Parse"/>.</param>
    /// <returns>What was imported, kept and left unmatched, and the limits reached.</returns>
    /// <exception cref="ImportRunningException">Another import of the user's is running.</exception>
    /// <remarks>
    /// It runs in one transaction: when any part fails, nothing is stored. Bookmarks and highlights
    /// past the user's limits are left out and the rest imports.
    /// </remarks>
    public ImportResult Import(Guid userId, ReadingDataFile file)
    {
        if (!_importing.TryAdd(userId, true))
        {
            throw new ImportRunningException();
        }

        try
        {
            return _store.RunInTransaction(() => ImportAll(userId, file));
        }
        finally
        {
            _importing.TryRemove(userId, out _);
        }
    }

    private ImportResult ImportAll(Guid userId, ReadingDataFile file)
    {
        IReadOnlyList<BookInfo>? books = null;
        var limited = new List<string>();
        int imported = 0, kept = 0, bookmarks = 0, highlights = 0;
        var unmatched = new List<UnmatchedBook>();
        var reported = new HashSet<string>(StringComparer.Ordinal);
        void Unmatched(string? title, IReadOnlyList<string>? authors, string? fileName)
        {
            // A book is reported once, however many of its positions, bookmarks and highlights it holds.
            if (reported.Add(string.Join('\n', [Normalize(title), Normalize(fileName), .. (authors ?? []).Select(Normalize).Order()])))
            {
                unmatched.Add(new UnmatchedBook(title, authors ?? [], fileName));
            }
        }

        foreach (var entry in file.Positions!)
        {
            var itemId = Match(userId, entry!.ItemId, entry.Title, entry.Authors, entry.FileName, () => books ??= _catalog.Books(userId));
            if (itemId is null)
            {
                Unmatched(entry.Title, entry.Authors, entry.FileName);
                continue;
            }

            var position = new StoredPosition(entry!.Cfi!, entry.Fraction!.Value, entry.SavedAt!.Value);
            var stored = _store.Get(userId, itemId.Value);
            if (stored is not null && stored.SavedAt >= position.SavedAt)
            {
                kept++;
                continue;
            }

            _store.Save(userId, itemId.Value, position);
            imported++;
        }

        foreach (var entry in file.Bookmarks ?? [])
        {
            var itemId = Match(userId, entry!.ItemId, entry.Title, entry.Authors, entry.FileName, () => books ??= _catalog.Books(userId));
            if (itemId is null)
            {
                Unmatched(entry.Title, entry.Authors, entry.FileName);
                continue;
            }

            try
            {
                if (_store.AddBookmark(userId, itemId.Value, entry.Cfi!, entry.Fraction!.Value, entry.Text!, entry.CreatedAt!.Value).Added)
                {
                    bookmarks++;
                }
            }
            catch (LimitReachedException reached)
            {
                limited.Add(reached.Limit);
                break;
            }
        }

        // The file's own highlighters the user does not have join the user's, while there is room.
        var own = _store.ListHighlighters(userId).Select(highlighter => new HighlighterEntry(highlighter.Id, highlighter.Name, highlighter.Colour)).ToList();
        var ids = own.Select(highlighter => highlighter.Id).ToHashSet(StringComparer.Ordinal);
        var builtIns = PositionStore.BuiltInHighlighters.Select(builtIn => builtIn.Id).ToHashSet(StringComparer.Ordinal);
        var highlighters = 0;
        foreach (var entry in file.Highlighters ?? [])
        {
            if (own.Count >= Controllers.HighlightersController.MaxHighlighters || builtIns.Contains(entry!.Id!) || !ids.Add(entry.Id!))
            {
                continue;
            }

            own.Add(new HighlighterEntry(entry.Id!, entry.Name!.Trim(), entry.Colour!.ToLowerInvariant()));
            highlighters++;
        }

        if (highlighters > 0)
        {
            _store.ReplaceHighlighters(userId, own);
        }

        foreach (var entry in file.Highlights ?? [])
        {
            var itemId = Match(userId, entry!.ItemId, entry.Title, entry.Authors, entry.FileName, () => books ??= _catalog.Books(userId));
            if (itemId is null)
            {
                Unmatched(entry.Title, entry.Authors, entry.FileName);
                continue;
            }

            try
            {
                if (_store.AddHighlight(userId, itemId.Value, entry.Cfi!, entry.Fraction!.Value, ids.Contains(entry.Colour!) ? entry.Colour! : PositionStore.FallbackHighlighter, entry.Text!, entry.CreatedAt!.Value, entry.Note ?? string.Empty).Added)
                {
                    highlights++;
                }
            }
            catch (LimitReachedException reached)
            {
                limited.Add(reached.Limit);
                break;
            }
        }

        var (themes, fonts, choices) = ImportSetup(userId, file);
        return new ImportResult(imported, kept, unmatched, bookmarks, highlights, highlighters, themes, fonts, choices, limited);
    }

    // The file's themes and fonts the user does not have join theirs while there is room, and its
    // chosen theme and font are taken only when the user has chosen none here.
    private (int Themes, int Fonts, bool Choices) ImportSetup(Guid userId, ReadingDataFile file)
    {
        var ownThemes = _store.ListThemes(userId).ToList();
        var themeIds = ownThemes.Select(theme => theme.Id).ToHashSet(StringComparer.Ordinal);
        var themes = 0;
        foreach (var entry in file.Themes ?? [])
        {
            if (ownThemes.Count >= PositionStore.MaxThemes || !themeIds.Add(entry!.Id!))
            {
                continue;
            }

            ownThemes.Add(new ThemeEntry(entry.Id!, entry.Name!.Trim(), entry.Colours().Select(colour => colour!.ToLowerInvariant()).ToList()));
            themes++;
        }

        if (themes > 0)
        {
            _store.ReplaceThemes(userId, ownThemes);
        }

        var faces = _store.ListFonts(userId).Select(font => (font.Font.Family, font.Font.Weight, font.Font.Italic)).ToHashSet();
        var families = new HashSet<string>(StringComparer.Ordinal);
        // Fonts are added only while an admin allows it; the rest of the file imports either way.
        var uploads = _configuration()?.EnableFontUploads == true;
        foreach (var entry in uploads ? file.Fonts ?? [] : [])
        {
            var font = FontFile.Read(entry!.Data)!;
            if (faces.Contains((font.Family, font.Weight, font.Italic)))
            {
                continue;
            }

            var added = _store.AddFont(userId, font, entry.Data!, DateTimeOffset.UtcNow).Result;
            if (added == FontAdded.TooMany)
            {
                break;
            }

            if (added == FontAdded.QuotaFull)
            {
                continue;
            }

            faces.Add((font.Family, font.Weight, font.Italic));
            families.Add(font.Family);
        }

        var choices = false;
        if (file.Choices is { } chosen && _store.GetChoices(userId) is null)
        {
            var familiesHere = _store.ListFonts(userId).Select(font => font.Font.Family).ToHashSet(StringComparer.Ordinal);
            var request = new Controllers.ChoicesController.ChoicesRequest(chosen.Theme, chosen.Font);
            if (Controllers.ChoicesController.Check(request, themeIds, familiesHere) is { } kept)
            {
                _store.SaveChoices(userId, kept);
                choices = true;
            }
        }

        return (themes, families.Count, choices);
    }

    private static bool Valid(ExportedPosition? entry) =>
        entry is { Cfi.Length: > 0 and <= MaxCfiLength, Fraction: { } fraction, SavedAt: not null }
        && !double.IsNaN(fraction) && fraction is >= 0 and <= 1
        && (entry.ItemId is null || Guid.TryParse(entry.ItemId, out _))
        && (entry.Authors is null || entry.Authors.All(author => author is not null));

    private static bool Valid(ExportedBookmark? entry) =>
        entry is { Cfi.Length: > 0 and <= MaxCfiLength, Fraction: { } fraction, Text.Length: <= Controllers.BookmarksController.MaxTextLength, CreatedAt: not null }
        && !double.IsNaN(fraction) && fraction is >= 0 and <= 1
        && (entry.ItemId is null || Guid.TryParse(entry.ItemId, out _))
        && (entry.Authors is null || entry.Authors.All(author => author is not null));

    private static bool Valid(ExportedHighlight? entry) =>
        entry is { Cfi.Length: > 0 and <= MaxCfiLength, Fraction: { } fraction, Colour.Length: > 0 and <= Controllers.HighlightersController.MaxIdLength, Text.Length: <= Controllers.HighlightsController.MaxTextLength, CreatedAt: not null }
        && entry.Note is not { Length: > Controllers.HighlightsController.MaxNoteLength }
        && !double.IsNaN(fraction) && fraction is >= 0 and <= 1
        && (entry.ItemId is null || Guid.TryParse(entry.ItemId, out _))
        && (entry.Authors is null || entry.Authors.All(author => author is not null));

    private static bool Valid(ExportedHighlighter? entry) =>
        entry is { Id.Length: > 0 and <= Controllers.HighlightersController.MaxIdLength, Name: { } name }
        && name.Trim().Length is > 0 and <= Controllers.HighlightersController.MaxNameLength
        && Controllers.HighlightersController.IsColour(entry.Colour);

    private static bool Valid(ExportedTheme? entry) =>
        entry is { Id.Length: > 0 and <= 64, Name: { } name }
        && name.Trim().Length is > 0 and <= Controllers.ThemesController.MaxNameLength
        && entry.Colours().All(Controllers.HighlightersController.IsColour);

    private static bool Valid(ExportedFont? entry) =>
        entry is { Data: { Length: > 0 and <= Controllers.FontsController.MaxBytes } data } && FontFile.Read(data) is not null;

    private static string Normalize(string? value) => (value ?? string.Empty).Trim().ToUpperInvariant();

    private static Guid? Only(IEnumerable<BookInfo> candidates)
    {
        var found = candidates.Take(2).ToList();
        return found.Count == 1 ? found[0].ItemId : null;
    }

    private Guid? Match(Guid userId, string? id, string? entryTitle, IReadOnlyList<string>? entryAuthors, string? entryFileName, Func<IReadOnlyList<BookInfo>> books)
    {
        if (Guid.TryParse(id, out var itemId) && _catalog.Find(userId, itemId) is not null)
        {
            return itemId;
        }

        var title = Normalize(entryTitle);
        if (title.Length > 0)
        {
            var authors = (entryAuthors ?? []).Select(Normalize).Order().ToList();
            var byTitle = Only(books().Where(book =>
                Normalize(book.Title) == title && book.Authors.Select(Normalize).Order().SequenceEqual(authors)));
            if (byTitle is not null)
            {
                return byTitle;
            }
        }

        var fileName = Normalize(entryFileName);
        return fileName.Length > 0 ? Only(books().Where(book => Normalize(book.FileName) == fileName)) : null;
    }
}
