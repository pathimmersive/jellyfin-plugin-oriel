using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using Microsoft.Data.Sqlite;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// A reading position as stored: where in the book, how far through it, and when it was saved.
/// </summary>
/// <param name="Cfi">The EPUB CFI of the position.</param>
/// <param name="Fraction">How far through the book the position is, from 0 to 1.</param>
/// <param name="SavedAt">When the position was saved.</param>
public sealed record StoredPosition(string Cfi, double Fraction, DateTimeOffset SavedAt);

/// <summary>
/// A bookmark as stored: where the page it marks starts, the text it opens with, and when it was made.
/// </summary>
/// <param name="Id">The bookmark's id.</param>
/// <param name="Cfi">The EPUB CFI of the start of the page.</param>
/// <param name="Fraction">How far through the book the page is, from 0 to 1.</param>
/// <param name="Text">The text the page opens with, or its page number in a comic or PDF.</param>
/// <param name="CreatedAt">When the bookmark was made.</param>
public sealed record StoredBookmark(Guid Id, string Cfi, double Fraction, string Text, DateTimeOffset CreatedAt);

/// <summary>
/// A highlight as stored: the text it covers, its highlighter, its note, and when it was made.
/// </summary>
/// <param name="Id">The highlight's id.</param>
/// <param name="Cfi">The EPUB range CFI of the highlighted text.</param>
/// <param name="Fraction">How far through the book the page it was made on is, from 0 to 1.</param>
/// <param name="Colour">Its highlighter's colour.</param>
/// <param name="Text">The highlighted text.</param>
/// <param name="CreatedAt">When the highlight was made.</param>
/// <param name="Note">The reader's note on it; empty for none.</param>
public sealed record StoredHighlight(Guid Id, string Cfi, double Fraction, string Colour, string Text, DateTimeOffset CreatedAt, string Note = "");

/// <summary>
/// A highlighter as kept: its id, name and colour, as a whole list replaces it.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Name">Its name.</param>
/// <param name="Colour">Its colour, as #rrggbb.</param>
public sealed record HighlighterEntry(string Id, string Name, string Colour);

/// <summary>
/// A user's highlighter as listed: its id, name and colour, whether it is built in, and how many highlights use it.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Name">Its name.</param>
/// <param name="Colour">Its colour, as #rrggbb.</param>
/// <param name="BuiltIn">True for the four built-ins.</param>
/// <param name="Uses">How many of the user's highlights, in every book, are in it.</param>
public sealed record StoredHighlighter(string Id, string Name, string Colour, bool BuiltIn, int Uses);

/// <summary>
/// One of a user's font files as listed: its id, what the file says about itself, and when it was added.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Font">Its format, family, style, weight and italic.</param>
/// <param name="AddedAt">When it was added.</param>
public sealed record StoredFont(Guid Id, FontFile Font, DateTimeOffset AddedAt);

/// <summary>
/// One of a user's own themes: its id, its name and its ten colours, each #rrggbb, in the order of <see cref="PositionStore.ThemeColours"/>.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Name">Its name.</param>
/// <param name="Colours">Its colours.</param>
public sealed record ThemeEntry(string Id, string Name, IReadOnlyList<string> Colours);

/// <summary>
/// The theme and font a user has chosen, as the reader names them: a built-in theme or <c>own:&lt;id&gt;</c>,
/// a bundled font or <c>own:&lt;family&gt;</c>.
/// </summary>
/// <param name="Theme">The theme.</param>
/// <param name="Font">The font.</param>
public sealed record StoredChoices(string Theme, string Font);

/// <summary>
/// What adding a font file came to.
/// </summary>
public enum FontAdded
{
    /// <summary>The file was added, or replaced the user's file of its family, weight and italic.</summary>
    Added,

    /// <summary>The user already has <see cref="PositionStore.MaxFonts"/> files and this one replaces none.</summary>
    TooMany,
}

/// <summary>
/// The plugin's own SQLite database: reading positions, one per user and book, bookmarks and highlights.
/// </summary>
public class PositionStore
{
    /// <summary>
    /// The four built-in highlighters, in their first order: Quotes, Green, Vocabulary and Pink.
    /// </summary>
    public static readonly IReadOnlyList<HighlighterEntry> BuiltInHighlighters =
    [
        new("yellow", "Quotes", "#ffd54f"),
        new("green", "Green", "#81c784"),
        new("blue", "Vocabulary", "#64b5f6"),
        new("pink", "Pink", "#f06292"),
    ];

    /// <summary>
    /// The built-in highlighter a deleted highlighter's highlights move to: Quotes.
    /// </summary>
    public const string FallbackHighlighter = "yellow";

    /// <summary>
    /// The most font files a user keeps.
    /// </summary>
    public const int MaxFonts = 20;

    /// <summary>
    /// The most bookmarks a user keeps, in all their books.
    /// </summary>
    public const int MaxBookmarks = 5000;

    /// <summary>
    /// The most highlights a user keeps, in all their books.
    /// </summary>
    public const int MaxHighlights = 20000;

    /// <summary>
    /// The most themes of their own a user keeps.
    /// </summary>
    public const int MaxThemes = 12;

    /// <summary>
    /// A theme's colours, in the order they are kept.
    /// </summary>
    public static readonly IReadOnlyList<string> ThemeColours =
        ["background", "text", "secondary", "accent", "selection", "separator", "controls", "controlsText", "buttons", "grayed"];

    /// <summary>
    /// The schema, one step per version: entry n moves the database from version n to n + 1.
    /// </summary>
    public static readonly IReadOnlyList<string> Schema =
    [
        """
        CREATE TABLE positions (
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            cfi TEXT NOT NULL,
            fraction REAL NOT NULL,
            saved_at TEXT NOT NULL,
            PRIMARY KEY (user_id, item_id)
        )
        """,
        """
        CREATE TABLE bookmarks (
            id TEXT NOT NULL PRIMARY KEY,
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            cfi TEXT NOT NULL,
            fraction REAL NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (user_id, item_id, cfi)
        )
        """,
        """
        CREATE TABLE highlights (
            id TEXT NOT NULL PRIMARY KEY,
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            cfi TEXT NOT NULL,
            fraction REAL NOT NULL,
            colour TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (user_id, item_id, cfi)
        )
        """,
        "ALTER TABLE highlights ADD COLUMN note TEXT NOT NULL DEFAULT ''",
        """
        CREATE TABLE highlighters (
            user_id TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            colour TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        )
        """,
        """
        CREATE TABLE fonts (
            id TEXT NOT NULL PRIMARY KEY,
            user_id TEXT NOT NULL,
            family TEXT NOT NULL,
            style TEXT NOT NULL,
            weight INTEGER NOT NULL,
            italic INTEGER NOT NULL,
            format TEXT NOT NULL,
            data BLOB NOT NULL,
            added_at TEXT NOT NULL,
            UNIQUE (user_id, family, weight, italic)
        )
        """,
        """
        CREATE TABLE themes (
            user_id TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            colours TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        )
        """,
        """
        CREATE TABLE choices (
            user_id TEXT NOT NULL PRIMARY KEY,
            theme TEXT NOT NULL,
            font TEXT NOT NULL
        )
        """,
    ];

    private readonly string _connectionString;
    private readonly string _databasePath;
    private readonly IReadOnlyList<string> _migrations;
    private readonly object _migrateLock = new();
    private readonly AsyncLocal<Shared?> _shared = new();
    private bool _migrated;

    /// <summary>
    /// Initializes a new instance of the <see cref="PositionStore"/> class.
    /// </summary>
    /// <param name="databasePath">The database file; its folder is created when the store is first opened.</param>
    public PositionStore(string databasePath)
        : this(databasePath, Schema)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="PositionStore"/> class with a given schema.
    /// </summary>
    /// <param name="databasePath">The database file; its folder is created when the store is first opened.</param>
    /// <param name="migrations">The schema steps, oldest first.</param>
    public PositionStore(string databasePath, IReadOnlyList<string> migrations)
    {
        _databasePath = databasePath;
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString();
        _migrations = migrations;
    }

    /// <summary>
    /// Gets the database file.
    /// </summary>
    public string DatabasePath => _databasePath;

    /// <summary>
    /// Brings the database up to the current schema, applying each missing step in order.
    /// </summary>
    /// <returns>The schema version afterwards.</returns>
    /// <exception cref="InvalidOperationException">The database is at a schema newer than this plugin's.</exception>
    public int Migrate()
    {
        lock (_migrateLock)
        {
            var folder = Path.GetDirectoryName(Path.GetFullPath(_databasePath));
            if (!string.IsNullOrEmpty(folder))
            {
                Directory.CreateDirectory(folder);
            }

            using var connection = OpenConnection();
            Execute(connection, "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
            using (var read = connection.CreateCommand())
            {
                read.CommandText = "SELECT version FROM schema_version";
                var current = read.ExecuteScalar() is long stored ? (int)stored : 0;
                if (current > _migrations.Count)
                {
                    throw new InvalidOperationException(
                        $"The reading position database is at schema version {current}, newer than this plugin's {_migrations.Count}.");
                }

                for (var version = current; version < _migrations.Count; version++)
                {
                    using var transaction = connection.BeginTransaction();
                    Execute(connection, _migrations[version], transaction);
                    Execute(connection, "DELETE FROM schema_version", transaction);
                    Execute(connection, $"INSERT INTO schema_version (version) VALUES ({version + 1})", transaction);
                    transaction.Commit();
                }
            }

            _migrated = true;
            return _migrations.Count;
        }
    }

    /// <summary>
    /// Gets a user's position in a book.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <returns>The position, or null when none is stored.</returns>
    public StoredPosition? Get(Guid userId, Guid itemId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT cfi, fraction, saved_at FROM positions WHERE user_id = $user AND item_id = $item";
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$item", Key(itemId));
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        return Position(reader, 0);
    }

    /// <summary>
    /// Gets all of a user's positions.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>Each book the user has a position in, with that position.</returns>
    public IReadOnlyList<KeyValuePair<Guid, StoredPosition>> ListForUser(Guid userId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT item_id, cfi, fraction, saved_at FROM positions WHERE user_id = $user ORDER BY item_id";
        command.Parameters.AddWithValue("$user", Key(userId));
        using var reader = command.ExecuteReader();
        var positions = new List<KeyValuePair<Guid, StoredPosition>>();
        while (reader.Read())
        {
            positions.Add(new(Guid.ParseExact(reader.GetString(0), "N"), Position(reader, 1)));
        }

        return positions;
    }

    /// <summary>
    /// Saves a user's position in a book, replacing the previous one.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="position">The position to keep.</param>
    public void Save(Guid userId, Guid itemId, StoredPosition position)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            INSERT INTO positions (user_id, item_id, cfi, fraction, saved_at)
            VALUES ($user, $item, $cfi, $fraction, $saved)
            ON CONFLICT (user_id, item_id) DO UPDATE SET
                cfi = excluded.cfi, fraction = excluded.fraction, saved_at = excluded.saved_at
            """;
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$item", Key(itemId));
        command.Parameters.AddWithValue("$cfi", position.Cfi);
        command.Parameters.AddWithValue("$fraction", position.Fraction);
        command.Parameters.AddWithValue("$saved", position.SavedAt.ToString("O", CultureInfo.InvariantCulture));
        command.ExecuteNonQuery();
    }

    /// <summary>
    /// Gets a user's bookmarks in a book, in book order.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <returns>The bookmarks, none when the user has made none.</returns>
    public IReadOnlyList<StoredBookmark> ListBookmarks(Guid userId, Guid itemId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT id, cfi, fraction, text, created_at FROM bookmarks WHERE user_id = $user AND item_id = $item ORDER BY fraction, created_at";
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$item", Key(itemId));
        using var reader = command.ExecuteReader();
        var bookmarks = new List<StoredBookmark>();
        while (reader.Read())
        {
            bookmarks.Add(Bookmark(reader, 0));
        }

        return bookmarks;
    }

    /// <summary>
    /// Gets all of a user's bookmarks.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>Each bookmark with its book, by book and then in book order.</returns>
    public IReadOnlyList<KeyValuePair<Guid, StoredBookmark>> ListBookmarksForUser(Guid userId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT item_id, id, cfi, fraction, text, created_at FROM bookmarks WHERE user_id = $user ORDER BY item_id, fraction, created_at";
        command.Parameters.AddWithValue("$user", Key(userId));
        using var reader = command.ExecuteReader();
        var bookmarks = new List<KeyValuePair<Guid, StoredBookmark>>();
        while (reader.Read())
        {
            bookmarks.Add(new(Guid.ParseExact(reader.GetString(0), "N"), Bookmark(reader, 1)));
        }

        return bookmarks;
    }

    /// <summary>
    /// Adds a bookmark to a user's book, unless one is already at the same CFI.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="cfi">The EPUB CFI of the start of the page.</param>
    /// <param name="fraction">How far through the book the page is, from 0 to 1.</param>
    /// <param name="text">The text the page opens with.</param>
    /// <param name="createdAt">When the bookmark was made.</param>
    /// <returns>The bookmark at that CFI, and whether it was added now.</returns>
    /// <exception cref="LimitReachedException">The bookmark is new and the user already has <see cref="MaxBookmarks"/>.</exception>
    public (StoredBookmark Bookmark, bool Added) AddBookmark(Guid userId, Guid itemId, string cfi, double fraction, string text, DateTimeOffset createdAt)
    {
        EnsureMigrated();
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var isNew = !Exists(connection, "bookmarks", userId, itemId, cfi);
        if (isNew && Count(connection, "bookmarks", userId) >= MaxBookmarks)
        {
            throw new LimitReachedException("bookmarks");
        }

        int added;
        using (var insert = connection.CreateCommand())
        {
            insert.CommandText =
                """
                INSERT INTO bookmarks (id, user_id, item_id, cfi, fraction, text, created_at)
                VALUES ($id, $user, $item, $cfi, $fraction, $text, $created)
                ON CONFLICT (user_id, item_id, cfi) DO NOTHING
                """;
            insert.Parameters.AddWithValue("$id", Key(Guid.NewGuid()));
            insert.Parameters.AddWithValue("$user", Key(userId));
            insert.Parameters.AddWithValue("$item", Key(itemId));
            insert.Parameters.AddWithValue("$cfi", cfi);
            insert.Parameters.AddWithValue("$fraction", fraction);
            insert.Parameters.AddWithValue("$text", text);
            insert.Parameters.AddWithValue("$created", createdAt.ToString("O", CultureInfo.InvariantCulture));
            added = insert.ExecuteNonQuery();
        }

        using var read = connection.CreateCommand();
        read.CommandText =
            "SELECT id, cfi, fraction, text, created_at FROM bookmarks WHERE user_id = $user AND item_id = $item AND cfi = $cfi";
        read.Parameters.AddWithValue("$user", Key(userId));
        read.Parameters.AddWithValue("$item", Key(itemId));
        read.Parameters.AddWithValue("$cfi", cfi);
        using var reader = read.ExecuteReader();
        reader.Read();
        var bookmark = Bookmark(reader, 0);
        reader.Close();
        transaction.Commit();
        if (added > 0)
        {
            connection.Added("bookmarks", userId);
        }

        return (bookmark, added > 0);
    }

    /// <summary>
    /// Removes one of a user's bookmarks in a book.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="bookmarkId">The bookmark.</param>
    /// <returns>False when the user has no such bookmark in the book.</returns>
    public bool RemoveBookmark(Guid userId, Guid itemId, Guid bookmarkId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM bookmarks WHERE id = $id AND user_id = $user AND item_id = $item";
        command.Parameters.AddWithValue("$id", Key(bookmarkId));
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$item", Key(itemId));
        return command.ExecuteNonQuery() > 0;
    }

    /// <summary>
    /// Gets a user's highlights in a book, in book order.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <returns>The highlights, none when the user has made none.</returns>
    public IReadOnlyList<StoredHighlight> ListHighlights(Guid userId, Guid itemId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT id, cfi, fraction, colour, text, created_at, note FROM highlights WHERE user_id = $user AND item_id = $item ORDER BY fraction, created_at";
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$item", Key(itemId));
        using var reader = command.ExecuteReader();
        var highlights = new List<StoredHighlight>();
        while (reader.Read())
        {
            highlights.Add(Highlight(reader, 0));
        }

        return highlights;
    }

    /// <summary>
    /// Gets all of a user's highlights.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>Each highlight with its book, by book and then in book order.</returns>
    public IReadOnlyList<KeyValuePair<Guid, StoredHighlight>> ListHighlightsForUser(Guid userId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT item_id, id, cfi, fraction, colour, text, created_at, note FROM highlights WHERE user_id = $user ORDER BY item_id, fraction, created_at";
        command.Parameters.AddWithValue("$user", Key(userId));
        using var reader = command.ExecuteReader();
        var highlights = new List<KeyValuePair<Guid, StoredHighlight>>();
        while (reader.Read())
        {
            highlights.Add(new(Guid.ParseExact(reader.GetString(0), "N"), Highlight(reader, 1)));
        }

        return highlights;
    }

    /// <summary>
    /// Adds a highlight to a user's book, unless one is already at the same CFI.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="cfi">The EPUB range CFI of the highlighted text.</param>
    /// <param name="fraction">How far through the book the page it was made on is, from 0 to 1.</param>
    /// <param name="colour">Its highlighter's colour.</param>
    /// <param name="text">The highlighted text.</param>
    /// <param name="createdAt">When the highlight was made.</param>
    /// <param name="note">The reader's note on it; empty for none.</param>
    /// <returns>The highlight at that CFI, and whether it was added now.</returns>
    /// <exception cref="LimitReachedException">The highlight is new and the user already has <see cref="MaxHighlights"/>.</exception>
    public (StoredHighlight Highlight, bool Added) AddHighlight(Guid userId, Guid itemId, string cfi, double fraction, string colour, string text, DateTimeOffset createdAt, string note = "")
    {
        EnsureMigrated();
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var isNew = !Exists(connection, "highlights", userId, itemId, cfi);
        if (isNew && Count(connection, "highlights", userId) >= MaxHighlights)
        {
            throw new LimitReachedException("highlights");
        }

        int added;
        using (var insert = connection.CreateCommand())
        {
            insert.CommandText =
                """
                INSERT INTO highlights (id, user_id, item_id, cfi, fraction, colour, text, created_at, note)
                VALUES ($id, $user, $item, $cfi, $fraction, $colour, $text, $created, $note)
                ON CONFLICT (user_id, item_id, cfi) DO NOTHING
                """;
            insert.Parameters.AddWithValue("$id", Key(Guid.NewGuid()));
            insert.Parameters.AddWithValue("$user", Key(userId));
            insert.Parameters.AddWithValue("$item", Key(itemId));
            insert.Parameters.AddWithValue("$cfi", cfi);
            insert.Parameters.AddWithValue("$fraction", fraction);
            insert.Parameters.AddWithValue("$colour", colour);
            insert.Parameters.AddWithValue("$text", text);
            insert.Parameters.AddWithValue("$created", createdAt.ToString("O", CultureInfo.InvariantCulture));
            insert.Parameters.AddWithValue("$note", note);
            added = insert.ExecuteNonQuery();
        }

        using var read = connection.CreateCommand();
        read.CommandText =
            "SELECT id, cfi, fraction, colour, text, created_at, note FROM highlights WHERE user_id = $user AND item_id = $item AND cfi = $cfi";
        read.Parameters.AddWithValue("$user", Key(userId));
        read.Parameters.AddWithValue("$item", Key(itemId));
        read.Parameters.AddWithValue("$cfi", cfi);
        using var reader = read.ExecuteReader();
        reader.Read();
        var highlight = Highlight(reader, 0);
        reader.Close();
        transaction.Commit();
        if (added > 0)
        {
            connection.Added("highlights", userId);
        }

        return (highlight, added > 0);
    }

    /// <summary>
    /// Changes the highlighter or the note, or both, of one of a user's highlights in a book.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="highlightId">The highlight.</param>
    /// <param name="colour">The new highlighter's colour, or null to keep it.</param>
    /// <param name="note">The new note (empty for none), or null to keep it.</param>
    /// <returns>The highlight as it is now, or null when the user has no such highlight in the book.</returns>
    public StoredHighlight? UpdateHighlight(Guid userId, Guid itemId, Guid highlightId, string? colour, string? note)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            UPDATE highlights SET colour = coalesce($colour, colour), note = coalesce($note, note)
            WHERE id = $id AND user_id = $user AND item_id = $item
            RETURNING id, cfi, fraction, colour, text, created_at, note
            """;
        command.Parameters.AddWithValue("$colour", (object?)colour ?? DBNull.Value);
        command.Parameters.AddWithValue("$note", (object?)note ?? DBNull.Value);
        command.Parameters.AddWithValue("$id", Key(highlightId));
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$item", Key(itemId));
        using var reader = command.ExecuteReader();
        return reader.Read() ? Highlight(reader, 0) : null;
    }

    /// <summary>
    /// Removes one of a user's highlights in a book.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="highlightId">The highlight.</param>
    /// <returns>False when the user has no such highlight in the book.</returns>
    public bool RemoveHighlight(Guid userId, Guid itemId, Guid highlightId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM highlights WHERE id = $id AND user_id = $user AND item_id = $item";
        command.Parameters.AddWithValue("$id", Key(highlightId));
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$item", Key(itemId));
        return command.ExecuteNonQuery() > 0;
    }

    /// <summary>
    /// Gets a user's highlighters in their order, with how many of the user's highlights use each.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The highlighters; the built-ins for a user who has changed nothing.</returns>
    public IReadOnlyList<StoredHighlighter> ListHighlighters(Guid userId)
    {
        EnsureMigrated();
        using var connection = Open();
        var uses = new Dictionary<string, int>(StringComparer.Ordinal);
        using (var count = connection.CreateCommand())
        {
            count.CommandText = "SELECT colour, COUNT(*) FROM highlights WHERE user_id = $user GROUP BY colour";
            count.Parameters.AddWithValue("$user", Key(userId));
            using var reader = count.ExecuteReader();
            while (reader.Read())
            {
                uses[reader.GetString(0)] = reader.GetInt32(1);
            }
        }

        var entries = new List<HighlighterEntry>();
        using (var read = connection.CreateCommand())
        {
            read.CommandText = "SELECT id, name, colour FROM highlighters WHERE user_id = $user ORDER BY position";
            read.Parameters.AddWithValue("$user", Key(userId));
            using var reader = read.ExecuteReader();
            while (reader.Read())
            {
                entries.Add(new HighlighterEntry(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
            }
        }

        var builtIns = BuiltInHighlighters.Select(builtIn => builtIn.Id).ToHashSet(StringComparer.Ordinal);
        return (entries.Count > 0 ? entries : BuiltInHighlighters)
            .Select(entry => new StoredHighlighter(entry.Id, entry.Name, entry.Colour, builtIns.Contains(entry.Id), uses.GetValueOrDefault(entry.Id)))
            .ToList();
    }

    /// <summary>
    /// Replaces a user's highlighters with a whole, checked list. The user's own highlighters left out are
    /// deleted, and their highlights move to Quotes.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="highlighters">The list, in its order; the built-ins all in it.</param>
    /// <returns>The highlighters as <see cref="ListHighlighters"/> gives them.</returns>
    public IReadOnlyList<StoredHighlighter> ReplaceHighlighters(Guid userId, IReadOnlyList<HighlighterEntry> highlighters)
    {
        var kept = highlighters.Select(highlighter => highlighter.Id).ToHashSet(StringComparer.Ordinal);
        var gone = ListHighlighters(userId).Where(highlighter => !highlighter.BuiltIn && !kept.Contains(highlighter.Id)).Select(highlighter => highlighter.Id).ToList();
        using (var connection = Open())
        using (var transaction = connection.BeginTransaction())
        {
            foreach (var id in gone)
            {
                using var move = connection.CreateCommand();
                move.CommandText = "UPDATE highlights SET colour = $fallback WHERE user_id = $user AND colour = $id";
                move.Parameters.AddWithValue("$fallback", FallbackHighlighter);
                move.Parameters.AddWithValue("$user", Key(userId));
                move.Parameters.AddWithValue("$id", id);
                move.ExecuteNonQuery();
            }

            using (var clear = connection.CreateCommand())
            {
                clear.CommandText = "DELETE FROM highlighters WHERE user_id = $user";
                clear.Parameters.AddWithValue("$user", Key(userId));
                clear.ExecuteNonQuery();
            }

            for (var position = 0; position < highlighters.Count; position++)
            {
                using var insert = connection.CreateCommand();
                insert.CommandText = "INSERT INTO highlighters (user_id, id, name, colour, position) VALUES ($user, $id, $name, $colour, $position)";
                insert.Parameters.AddWithValue("$user", Key(userId));
                insert.Parameters.AddWithValue("$id", highlighters[position].Id);
                insert.Parameters.AddWithValue("$name", highlighters[position].Name);
                insert.Parameters.AddWithValue("$colour", highlighters[position].Colour);
                insert.Parameters.AddWithValue("$position", position);
                insert.ExecuteNonQuery();
            }

            transaction.Commit();
        }

        return ListHighlighters(userId);
    }

    /// <summary>
    /// Gets the ids of a user's highlighters, which a highlight's colour must be one of.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The ids.</returns>
    public IReadOnlySet<string> HighlighterIds(Guid userId) =>
        ListHighlighters(userId).Select(highlighter => highlighter.Id).ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// Gets a user's font files, without their data: by family, then weight, then upright before italic.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The files.</returns>
    public IReadOnlyList<StoredFont> ListFonts(Guid userId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, format, family, style, weight, italic, added_at FROM fonts WHERE user_id = $user ORDER BY family, weight, italic";
        command.Parameters.AddWithValue("$user", Key(userId));
        using var reader = command.ExecuteReader();
        var fonts = new List<StoredFont>();
        while (reader.Read())
        {
            fonts.Add(new StoredFont(
                Guid.ParseExact(reader.GetString(0), "N"),
                new FontFile(reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4), reader.GetInt64(5) != 0),
                DateTimeOffset.Parse(reader.GetString(6), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind)));
        }

        return fonts;
    }

    /// <summary>
    /// Adds a user's font file, in place of their file of the same family, weight and italic if they have one.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="font">What the file says about itself.</param>
    /// <param name="data">The file.</param>
    /// <param name="addedAt">When it was added.</param>
    /// <returns>The file as listed, or null with <see cref="FontAdded.TooMany"/> when the user has no room for it.</returns>
    public (StoredFont? Font, FontAdded Result) AddFont(Guid userId, FontFile font, byte[] data, DateTimeOffset addedAt)
    {
        EnsureMigrated();
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using (var replace = connection.CreateCommand())
        {
            replace.CommandText = "DELETE FROM fonts WHERE user_id = $user AND family = $family AND weight = $weight AND italic = $italic";
            replace.Parameters.AddWithValue("$user", Key(userId));
            replace.Parameters.AddWithValue("$family", font.Family);
            replace.Parameters.AddWithValue("$weight", font.Weight);
            replace.Parameters.AddWithValue("$italic", font.Italic ? 1 : 0);
            replace.ExecuteNonQuery();
        }

        using (var count = connection.CreateCommand())
        {
            count.CommandText = "SELECT COUNT(*) FROM fonts WHERE user_id = $user";
            count.Parameters.AddWithValue("$user", Key(userId));
            if ((long)count.ExecuteScalar()! >= MaxFonts)
            {
                transaction.Rollback();
                return (null, FontAdded.TooMany);
            }
        }

        var stored = new StoredFont(Guid.NewGuid(), font, addedAt);
        using (var insert = connection.CreateCommand())
        {
            insert.CommandText = "INSERT INTO fonts (id, user_id, family, style, weight, italic, format, data, added_at) VALUES ($id, $user, $family, $style, $weight, $italic, $format, $data, $added)";
            insert.Parameters.AddWithValue("$id", Key(stored.Id));
            insert.Parameters.AddWithValue("$user", Key(userId));
            insert.Parameters.AddWithValue("$family", font.Family);
            insert.Parameters.AddWithValue("$style", font.Style);
            insert.Parameters.AddWithValue("$weight", font.Weight);
            insert.Parameters.AddWithValue("$italic", font.Italic ? 1 : 0);
            insert.Parameters.AddWithValue("$format", font.Format);
            insert.Parameters.AddWithValue("$data", data);
            insert.Parameters.AddWithValue("$added", addedAt.ToString("O", CultureInfo.InvariantCulture));
            insert.ExecuteNonQuery();
        }

        transaction.Commit();
        return (stored, FontAdded.Added);
    }

    /// <summary>
    /// Gets one of a user's font files.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="fontId">The file.</param>
    /// <returns>Its format and data, or null when the user has no such file.</returns>
    public (string Format, byte[] Data)? GetFontData(Guid userId, Guid fontId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT format, data FROM fonts WHERE id = $id AND user_id = $user";
        command.Parameters.AddWithValue("$id", Key(fontId));
        command.Parameters.AddWithValue("$user", Key(userId));
        using var reader = command.ExecuteReader();
        return reader.Read() ? (reader.GetString(0), (byte[])reader.GetValue(1)) : null;
    }

    /// <summary>
    /// Removes every file of one of a user's font families.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="family">The family.</param>
    /// <returns>How many files were removed.</returns>
    public int RemoveFontFamily(Guid userId, string family)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM fonts WHERE user_id = $user AND family = $family";
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$family", family);
        return command.ExecuteNonQuery();
    }

    /// <summary>
    /// Gets a user's own themes in their order.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The themes; none for a user who has made none.</returns>
    public IReadOnlyList<ThemeEntry> ListThemes(Guid userId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, name, colours FROM themes WHERE user_id = $user ORDER BY position";
        command.Parameters.AddWithValue("$user", Key(userId));
        using var reader = command.ExecuteReader();
        var themes = new List<ThemeEntry>();
        while (reader.Read())
        {
            themes.Add(new ThemeEntry(reader.GetString(0), reader.GetString(1), reader.GetString(2).Split(' ')));
        }

        return themes;
    }

    /// <summary>
    /// Replaces a user's own themes with a whole, checked list; those left out are deleted.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="themes">The list, in its order.</param>
    /// <returns>The themes as <see cref="ListThemes"/> gives them.</returns>
    public IReadOnlyList<ThemeEntry> ReplaceThemes(Guid userId, IReadOnlyList<ThemeEntry> themes)
    {
        EnsureMigrated();
        using (var connection = Open())
        using (var transaction = connection.BeginTransaction())
        {
            using (var clear = connection.CreateCommand())
            {
                clear.CommandText = "DELETE FROM themes WHERE user_id = $user";
                clear.Parameters.AddWithValue("$user", Key(userId));
                clear.ExecuteNonQuery();
            }

            for (var position = 0; position < themes.Count; position++)
            {
                using var insert = connection.CreateCommand();
                insert.CommandText = "INSERT INTO themes (user_id, id, name, colours, position) VALUES ($user, $id, $name, $colours, $position)";
                insert.Parameters.AddWithValue("$user", Key(userId));
                insert.Parameters.AddWithValue("$id", themes[position].Id);
                insert.Parameters.AddWithValue("$name", themes[position].Name);
                insert.Parameters.AddWithValue("$colours", string.Join(' ', themes[position].Colours));
                insert.Parameters.AddWithValue("$position", position);
                insert.ExecuteNonQuery();
            }

            transaction.Commit();
        }

        return ListThemes(userId);
    }

    /// <summary>
    /// Gets the theme and font a user has chosen.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The choices; null for a user who has made none.</returns>
    public StoredChoices? GetChoices(Guid userId)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT theme, font FROM choices WHERE user_id = $user";
        command.Parameters.AddWithValue("$user", Key(userId));
        using var reader = command.ExecuteReader();
        return reader.Read() ? new StoredChoices(reader.GetString(0), reader.GetString(1)) : null;
    }

    /// <summary>
    /// Keeps the theme and font a user has chosen, in place of any kept before.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="choices">The checked choices.</param>
    public void SaveChoices(Guid userId, StoredChoices choices)
    {
        EnsureMigrated();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO choices (user_id, theme, font) VALUES ($user, $theme, $font) ON CONFLICT (user_id) DO UPDATE SET theme = excluded.theme, font = excluded.font";
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$theme", choices.Theme);
        command.Parameters.AddWithValue("$font", choices.Font);
        command.ExecuteNonQuery();
    }

    private static string Key(Guid id) => id.ToString("N", CultureInfo.InvariantCulture);

    // The id, cfi, fraction, colour, text, created_at and note columns, starting at `first`.
    private static StoredHighlight Highlight(SqliteDataReader reader, int first) => new(
        Guid.ParseExact(reader.GetString(first), "N"),
        reader.GetString(first + 1),
        reader.GetDouble(first + 2),
        reader.GetString(first + 3),
        reader.GetString(first + 4),
        DateTimeOffset.Parse(reader.GetString(first + 5), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
        reader.GetString(first + 6));

    // The id, cfi, fraction, text and created_at columns, starting at `first`.
    private static StoredBookmark Bookmark(SqliteDataReader reader, int first) => new(
        Guid.ParseExact(reader.GetString(first), "N"),
        reader.GetString(first + 1),
        reader.GetDouble(first + 2),
        reader.GetString(first + 3),
        DateTimeOffset.Parse(reader.GetString(first + 4), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));

    // The cfi, fraction and saved_at columns, starting at `first`.
    private static StoredPosition Position(SqliteDataReader reader, int first) => new(
        reader.GetString(first),
        reader.GetDouble(first + 1),
        DateTimeOffset.Parse(reader.GetString(first + 2), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));

    private static void Execute(SqliteConnection connection, string sql, SqliteTransaction? transaction = null)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    // Opens the store on first use; while it cannot be opened, every use fails as unavailable and tries again.
    private void EnsureMigrated()
    {
        if (_migrated)
        {
            return;
        }

        try
        {
            Migrate();
        }
        catch (Exception exception)
        {
            throw new StoreUnavailableException($"Oriel's reading data store at {_databasePath} cannot be opened: {exception.Message}", exception);
        }
    }

    /// <summary>
    /// Runs work against the store in one transaction on one connection: every store method it calls
    /// uses them, and nothing it wrote is kept unless all of it succeeds.
    /// </summary>
    /// <typeparam name="T">What the work returns.</typeparam>
    /// <param name="work">The work.</param>
    /// <returns>What the work returned.</returns>
    public T RunInTransaction<T>(Func<T> work)
    {
        if (_shared.Value is not null)
        {
            return work();
        }

        EnsureMigrated();
        using var connection = OpenConnection();
        Execute(connection, "BEGIN IMMEDIATE");
        _shared.Value = new Shared(connection);
        try
        {
            var result = work();
            Execute(connection, "COMMIT");
            return result;
        }
        catch
        {
            Execute(connection, "ROLLBACK");
            throw;
        }
        finally
        {
            _shared.Value = null;
        }
    }

    private static bool Exists(Lease connection, string table, Guid userId, Guid itemId, string cfi)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT EXISTS (SELECT 1 FROM {table} WHERE user_id = $user AND item_id = $item AND cfi = $cfi)";
        command.Parameters.AddWithValue("$user", Key(userId));
        command.Parameters.AddWithValue("$item", Key(itemId));
        command.Parameters.AddWithValue("$cfi", cfi);
        return (long)command.ExecuteScalar()! != 0;
    }

    // How many rows a user has in a table; inside a shared transaction, counted once and kept up to date as rows are added.
    private static long Count(Lease connection, string table, Guid userId)
    {
        if (connection.Counted(table, userId) is { } known)
        {
            return known;
        }

        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM {table} WHERE user_id = $user";
        command.Parameters.AddWithValue("$user", Key(userId));
        var count = (long)command.ExecuteScalar()!;
        connection.Remember(table, userId, count);
        return count;
    }

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        return connection;
    }

    // The connection a store method uses: the one RunInTransaction shares while it runs, else its own.
    private Lease Open() => _shared.Value is { } shared ? new Lease(shared) : new Lease(OpenConnection());

    /// <summary>
    /// A connection lent to one store method, with transactions begun in SQL so they nest inside a shared one.
    /// </summary>
    private sealed class Lease : IDisposable
    {
        private readonly SqliteConnection _connection;
        private readonly Shared? _shared;
        private readonly bool _owned;

        public Lease(SqliteConnection connection)
        {
            _connection = connection;
            _owned = true;
        }

        public Lease(Shared shared)
        {
            _connection = shared.Connection;
            _shared = shared;
        }

        public SqliteCommand CreateCommand() => _connection.CreateCommand();

        public long? Counted(string table, Guid userId) => _shared?.Counts.TryGetValue((table, userId), out var count) == true ? count : null;

        public void Remember(string table, Guid userId, long count)
        {
            if (_shared is not null)
            {
                _shared.Counts[(table, userId)] = count;
            }
        }

        public void Added(string table, Guid userId)
        {
            if (_shared is not null && _shared.Counts.TryGetValue((table, userId), out var count))
            {
                _shared.Counts[(table, userId)] = count + 1;
            }
        }

        // Its own transaction on a connection of its own; a savepoint inside a shared transaction.
        public Scope BeginTransaction()
        {
            if (_owned)
            {
                Execute(_connection, "BEGIN IMMEDIATE");
                return new Scope(_connection, "COMMIT", "ROLLBACK");
            }

            var name = $"oriel_{++_shared!.Savepoints}";
            Execute(_connection, $"SAVEPOINT {name}");
            return new Scope(_connection, $"RELEASE {name}", $"ROLLBACK TO {name}; RELEASE {name}");
        }

        public void Dispose()
        {
            if (_owned)
            {
                _connection.Dispose();
            }
        }
    }

    /// <summary>
    /// The connection and transaction RunInTransaction shares, with the row counts read in it.
    /// </summary>
    private sealed class Shared(SqliteConnection connection)
    {
        public SqliteConnection Connection { get; } = connection;

        public Dictionary<(string Table, Guid UserId), long> Counts { get; } = [];

        public int Savepoints { get; set; }
    }

    /// <summary>
    /// A transaction or savepoint, rolled back when disposed without being committed.
    /// </summary>
    private sealed class Scope : IDisposable
    {
        private readonly SqliteConnection _connection;
        private readonly string _commit;
        private readonly string _rollback;
        private bool _done;

        public Scope(SqliteConnection connection, string commit, string rollback)
        {
            _connection = connection;
            _commit = commit;
            _rollback = rollback;
        }

        public void Commit()
        {
            Execute(_connection, _commit);
            _done = true;
        }

        public void Rollback()
        {
            Execute(_connection, _rollback);
            _done = true;
        }

        public void Dispose()
        {
            if (!_done)
            {
                Rollback();
            }
        }
    }
}
