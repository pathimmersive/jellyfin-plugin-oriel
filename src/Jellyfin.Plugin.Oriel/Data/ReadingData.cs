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
public sealed record ReadingDataFile(
    [property: JsonPropertyName("format")] string? Format,
    [property: JsonPropertyName("version")] int? Version,
    [property: JsonPropertyName("exportedAt")] DateTimeOffset? ExportedAt,
    [property: JsonPropertyName("positions")] IReadOnlyList<ExportedPosition?>? Positions,
    [property: JsonPropertyName("bookmarks")] IReadOnlyList<ExportedBookmark?>? Bookmarks = null,
    [property: JsonPropertyName("highlights")] IReadOnlyList<ExportedHighlight?>? Highlights = null);

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
public sealed record ImportResult(
    [property: JsonPropertyName("imported")] int Imported,
    [property: JsonPropertyName("kept")] int Kept,
    [property: JsonPropertyName("unmatched")] IReadOnlyList<UnmatchedBook> Unmatched,
    [property: JsonPropertyName("bookmarks")] int Bookmarks = 0,
    [property: JsonPropertyName("highlights")] int Highlights = 0);

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
    public const int Version = 4;

    /// <summary>
    /// The longest CFI accepted, as when the reader saves a position.
    /// </summary>
    public const int MaxCfiLength = Controllers.PositionsController.MaxCfiLength;

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    private readonly PositionStore _store;
    private readonly IBookCatalog _catalog;

    /// <summary>
    /// Initializes a new instance of the <see cref="ReadingData"/> class.
    /// </summary>
    /// <param name="store">The position store.</param>
    /// <param name="catalog">The books each user can see.</param>
    public ReadingData(PositionStore store, IBookCatalog catalog)
    {
        _store = store;
        _catalog = catalog;
    }

    /// <summary>
    /// Builds a user's file: each stored position, bookmark and highlight in a book the user can still see.
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

        return new ReadingDataFile(Format, Version, now, positions, bookmarks, highlights);
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

        return positions.All(Valid) && (file.Bookmarks ?? []).All(Valid) && (file.Highlights ?? []).All(Valid) ? file : null;
    }

    /// <summary>
    /// Imports a file for a user. Each position goes to the book it matches, by item id, else by
    /// title and authors, else by file name, using only a match to exactly one book the user can see.
    /// It replaces the user's position in that book only when it was saved later. Each bookmark goes
    /// and each highlight go to their book the same way, and are added unless the user has one at the same place.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="file">A file accepted by <see cref="Parse"/>.</param>
    /// <returns>What was imported, kept and left unmatched.</returns>
    public ImportResult Import(Guid userId, ReadingDataFile file)
    {
        IReadOnlyList<BookInfo>? books = null;
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

            if (_store.AddBookmark(userId, itemId.Value, entry.Cfi!, entry.Fraction!.Value, entry.Text!, entry.CreatedAt!.Value).Added)
            {
                bookmarks++;
            }
        }

        foreach (var entry in file.Highlights ?? [])
        {
            var itemId = Match(userId, entry!.ItemId, entry.Title, entry.Authors, entry.FileName, () => books ??= _catalog.Books(userId));
            if (itemId is null)
            {
                Unmatched(entry.Title, entry.Authors, entry.FileName);
                continue;
            }

            if (_store.AddHighlight(userId, itemId.Value, entry.Cfi!, entry.Fraction!.Value, entry.Colour!, entry.Text!, entry.CreatedAt!.Value, entry.Note ?? string.Empty).Added)
            {
                highlights++;
            }
        }

        return new ImportResult(imported, kept, unmatched, bookmarks, highlights);
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
        entry is { Cfi.Length: > 0 and <= MaxCfiLength, Fraction: { } fraction, Colour: { } colour, Text.Length: <= Controllers.HighlightsController.MaxTextLength, CreatedAt: not null }
        && Controllers.HighlightsController.Colours.Contains(colour)
        && entry.Note is not { Length: > Controllers.HighlightsController.MaxNoteLength }
        && !double.IsNaN(fraction) && fraction is >= 0 and <= 1
        && (entry.ItemId is null || Guid.TryParse(entry.ItemId, out _))
        && (entry.Authors is null || entry.Authors.All(author => author is not null));

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
