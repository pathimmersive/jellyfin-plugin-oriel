using System;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// The theme and font a user has chosen, as the reader names them: a built-in theme or <c>own:&lt;id&gt;</c>,
/// a bundled font or <c>own:&lt;family&gt;</c>.
/// </summary>
/// <param name="Theme">The theme.</param>
/// <param name="Font">The font.</param>
public sealed record StoredChoices(string Theme, string Font);

/// <summary>
/// The theme and font each user has chosen, one row per user.
/// </summary>
public class ChoicesStore
{
    private readonly OrielDatabase _database;

    /// <summary>
    /// Initializes a new instance of the <see cref="ChoicesStore"/> class.
    /// </summary>
    /// <param name="database">The database.</param>
    public ChoicesStore(OrielDatabase database)
    {
        _database = database;
    }

    /// <summary>
    /// Gets the theme and font a user has chosen.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The choices; null for a user who has made none.</returns>
    public StoredChoices? Get(Guid userId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT theme, font FROM choices WHERE user_id = $user";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        using var reader = command.ExecuteReader();
        return reader.Read() ? new StoredChoices(reader.GetString(0), reader.GetString(1)) : null;
    }

    /// <summary>
    /// Keeps the theme and font a user has chosen, in place of any kept before.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="choices">The checked choices.</param>
    public void Save(Guid userId, StoredChoices choices)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO choices (user_id, theme, font) VALUES ($user, $theme, $font) ON CONFLICT (user_id) DO UPDATE SET theme = excluded.theme, font = excluded.font";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$theme", choices.Theme);
        command.Parameters.AddWithValue("$font", choices.Font);
        command.ExecuteNonQuery();
    }
}
