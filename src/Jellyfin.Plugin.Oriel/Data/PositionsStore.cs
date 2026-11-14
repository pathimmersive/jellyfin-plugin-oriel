using System;
using System.Collections.Generic;
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
/// Each user's exact position in each book, one per user and book.
/// </summary>
public class PositionsStore
{
    private readonly OrielDatabase _database;

    /// <summary>
    /// Initializes a new instance of the <see cref="PositionsStore"/> class.
    /// </summary>
    /// <param name="database">The database.</param>
    public PositionsStore(OrielDatabase database)
    {
        _database = database;
    }

    /// <summary>
    /// Gets a user's position in a book.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <returns>The position, or null when none is stored.</returns>
    public StoredPosition? Get(Guid userId, Guid itemId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT cfi, fraction, saved_at FROM positions WHERE user_id = $user AND item_id = $item";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        using var reader = command.ExecuteReader();
        return reader.Read() ? Position(reader, 0) : null;
    }

    /// <summary>
    /// Gets all of a user's positions.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>Each book the user has a position in, with that position.</returns>
    public IReadOnlyList<KeyValuePair<Guid, StoredPosition>> ListForUser(Guid userId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT item_id, cfi, fraction, saved_at FROM positions WHERE user_id = $user ORDER BY item_id";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
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
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            INSERT INTO positions (user_id, item_id, cfi, fraction, saved_at)
            VALUES ($user, $item, $cfi, $fraction, $saved)
            ON CONFLICT (user_id, item_id) DO UPDATE SET
                cfi = excluded.cfi, fraction = excluded.fraction, saved_at = excluded.saved_at
            """;
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        command.Parameters.AddWithValue("$cfi", position.Cfi);
        command.Parameters.AddWithValue("$fraction", position.Fraction);
        command.Parameters.AddWithValue("$saved", OrielDatabase.Time(position.SavedAt));
        command.ExecuteNonQuery();
    }

    // The cfi, fraction and saved_at columns, starting at `first`.
    private static StoredPosition Position(SqliteDataReader reader, int first) =>
        new(reader.GetString(first), reader.GetDouble(first + 1), OrielDatabase.Time(reader, first + 2));
}
