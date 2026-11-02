using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
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
/// The plugin's own SQLite database: reading positions, one per user and book, and bookmarks.
/// </summary>
public class PositionStore
{
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
    ];

    private readonly string _connectionString;
    private readonly IReadOnlyList<string> _migrations;
    private readonly object _migrateLock = new();
    private bool _migrated;

    /// <summary>
    /// Initializes a new instance of the <see cref="PositionStore"/> class.
    /// </summary>
    /// <param name="databasePath">The database file; its folder is created when missing.</param>
    public PositionStore(string databasePath)
        : this(databasePath, Schema)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="PositionStore"/> class with a given schema.
    /// </summary>
    /// <param name="databasePath">The database file; its folder is created when missing.</param>
    /// <param name="migrations">The schema steps, oldest first.</param>
    public PositionStore(string databasePath, IReadOnlyList<string> migrations)
    {
        var folder = Path.GetDirectoryName(Path.GetFullPath(databasePath));
        if (!string.IsNullOrEmpty(folder))
        {
            Directory.CreateDirectory(folder);
        }

        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString();
        _migrations = migrations;
    }

    /// <summary>
    /// Brings the database up to the current schema, applying each missing step in order.
    /// </summary>
    /// <returns>The schema version afterwards.</returns>
    public int Migrate()
    {
        lock (_migrateLock)
        {
            using var connection = Open();
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
    public (StoredBookmark Bookmark, bool Added) AddBookmark(Guid userId, Guid itemId, string cfi, double fraction, string text, DateTimeOffset createdAt)
    {
        EnsureMigrated();
        using var connection = Open();
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
        return (Bookmark(reader, 0), added > 0);
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

    private static string Key(Guid id) => id.ToString("N", CultureInfo.InvariantCulture);

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
        command.Transaction = transaction;
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private void EnsureMigrated()
    {
        if (!_migrated)
        {
            Migrate();
        }
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        return connection;
    }
}
