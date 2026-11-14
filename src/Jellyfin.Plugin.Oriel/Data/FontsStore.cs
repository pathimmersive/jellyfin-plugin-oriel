using System;
using System.Collections.Generic;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// One of a user's font files as listed: its id, what the file says about itself, and when it was added.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Font">Its format, family, style, weight and italic.</param>
/// <param name="AddedAt">When it was added.</param>
public sealed record StoredFont(Guid Id, FontFile Font, DateTimeOffset AddedAt);

/// <summary>
/// What adding a font file came to.
/// </summary>
public enum FontAdded
{
    /// <summary>The file was added, or replaced the user's file of its family, weight and italic.</summary>
    Added,

    /// <summary>The user already has <see cref="ReadingRules.MaxFonts"/> files and this one replaces none.</summary>
    TooMany,

    /// <summary>The user's files and this one would come to more than <see cref="ReadingRules.MaxFontBytes"/>.</summary>
    QuotaFull,
}

/// <summary>
/// Each user's own font files, one per family, weight and italic, within <see cref="ReadingRules.MaxFonts"/>
/// files and <see cref="ReadingRules.MaxFontBytes"/>.
/// </summary>
public class FontsStore
{
    private readonly OrielDatabase _database;

    /// <summary>
    /// Initializes a new instance of the <see cref="FontsStore"/> class.
    /// </summary>
    /// <param name="database">The database.</param>
    public FontsStore(OrielDatabase database)
    {
        _database = database;
    }

    /// <summary>
    /// Gets a user's font files, without their data: by family, then weight, then upright before italic.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The files.</returns>
    public IReadOnlyList<StoredFont> List(Guid userId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, format, family, style, weight, italic, added_at FROM fonts WHERE user_id = $user ORDER BY family, weight, italic";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        using var reader = command.ExecuteReader();
        var fonts = new List<StoredFont>();
        while (reader.Read())
        {
            fonts.Add(new StoredFont(
                Guid.ParseExact(reader.GetString(0), "N"),
                new FontFile(reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4), reader.GetInt64(5) != 0),
                OrielDatabase.Time(reader, 6)));
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
    /// <returns>
    /// The file as listed, or null with <see cref="FontAdded.TooMany"/> or <see cref="FontAdded.QuotaFull"/>
    /// when the user has no room for it.
    /// </returns>
    public (StoredFont? Font, FontAdded Result) Add(Guid userId, FontFile font, byte[] data, DateTimeOffset addedAt)
    {
        using var connection = _database.Open();
        using var transaction = connection.BeginTransaction();
        using (var replace = connection.CreateCommand())
        {
            replace.CommandText = "DELETE FROM fonts WHERE user_id = $user AND family = $family AND weight = $weight AND italic = $italic";
            replace.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
            replace.Parameters.AddWithValue("$family", font.Family);
            replace.Parameters.AddWithValue("$weight", font.Weight);
            replace.Parameters.AddWithValue("$italic", font.Italic ? 1 : 0);
            replace.ExecuteNonQuery();
        }

        using (var count = connection.CreateCommand())
        {
            count.CommandText = "SELECT COUNT(*) FROM fonts WHERE user_id = $user";
            count.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
            if ((long)count.ExecuteScalar()! >= ReadingRules.MaxFonts)
            {
                transaction.Rollback();
                return (null, FontAdded.TooMany);
            }
        }

        using (var size = connection.CreateCommand())
        {
            size.CommandText = "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM fonts WHERE user_id = $user";
            size.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
            if ((long)size.ExecuteScalar()! + data.LongLength > ReadingRules.MaxFontBytes)
            {
                transaction.Rollback();
                return (null, FontAdded.QuotaFull);
            }
        }

        var stored = new StoredFont(Guid.NewGuid(), font, addedAt);
        using (var insert = connection.CreateCommand())
        {
            insert.CommandText = "INSERT INTO fonts (id, user_id, family, style, weight, italic, format, data, added_at) VALUES ($id, $user, $family, $style, $weight, $italic, $format, $data, $added)";
            insert.Parameters.AddWithValue("$id", OrielDatabase.Key(stored.Id));
            insert.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
            insert.Parameters.AddWithValue("$family", font.Family);
            insert.Parameters.AddWithValue("$style", font.Style);
            insert.Parameters.AddWithValue("$weight", font.Weight);
            insert.Parameters.AddWithValue("$italic", font.Italic ? 1 : 0);
            insert.Parameters.AddWithValue("$format", font.Format);
            insert.Parameters.AddWithValue("$data", data);
            insert.Parameters.AddWithValue("$added", OrielDatabase.Time(addedAt));
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
    public (string Format, byte[] Data)? GetData(Guid userId, Guid fontId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT format, data FROM fonts WHERE id = $id AND user_id = $user";
        command.Parameters.AddWithValue("$id", OrielDatabase.Key(fontId));
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        using var reader = command.ExecuteReader();
        return reader.Read() ? (reader.GetString(0), (byte[])reader.GetValue(1)) : null;
    }

    /// <summary>
    /// Removes every file of one of a user's font families.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="family">The family.</param>
    /// <returns>How many files were removed.</returns>
    public int RemoveFamily(Guid userId, string family)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM fonts WHERE user_id = $user AND family = $family";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$family", family);
        return command.ExecuteNonQuery();
    }
}
