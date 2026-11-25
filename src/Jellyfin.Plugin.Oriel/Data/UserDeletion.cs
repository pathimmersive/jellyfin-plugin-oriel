using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Jellyfin.Data.Events.Users;
using MediaBrowser.Controller.Events;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// Deletes everything Oriel keeps for a user when Jellyfin deletes the user.
/// </summary>
public sealed partial class UserDeletion : IEventConsumer<UserDeletedEventArgs>
{
    private readonly OrielDatabase _database;
    private readonly ILogger<UserDeletion> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="UserDeletion"/> class.
    /// </summary>
    /// <param name="database">The database.</param>
    /// <param name="logger">The logger.</param>
    public UserDeletion(OrielDatabase database, ILogger<UserDeletion> logger)
    {
        _database = database;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task OnEvent(UserDeletedEventArgs eventArgs)
    {
        ArgumentNullException.ThrowIfNull(eventArgs);
        Delete(_database, _logger, eventArgs.Argument.Id, "deleted in Jellyfin");
        return Task.CompletedTask;
    }

    /// <summary>
    /// Deletes a user's rows and logs how many of each kind went; a store that cannot be opened is logged and left alone.
    /// </summary>
    /// <param name="database">The database.</param>
    /// <param name="logger">Where to log it.</param>
    /// <param name="userId">The user.</param>
    /// <param name="why">Why the user's data goes, for the log.</param>
    internal static void Delete(OrielDatabase database, ILogger logger, Guid userId, string why)
    {
        try
        {
            var removed = database.DeleteUser(userId);
#pragma warning disable CA1873 // Once a deleted user, over six counts.
            LogDeleted(logger, userId, why, removed.Values.Sum(), Describe(removed));
#pragma warning restore CA1873
        }
        catch (StoreUnavailableException)
        {
            LogStoreUnavailable(logger, userId);
        }
    }

    private static string Describe(IReadOnlyDictionary<string, int> removed) =>
        string.Join(", ", removed.Select(kind => $"{kind.Value} {kind.Key}"));

    [LoggerMessage(Level = LogLevel.Information, Message = "Oriel deleted the reading data of user {UserId}, {Why}: {Total} rows ({Rows})")]
    private static partial void LogDeleted(ILogger logger, Guid userId, string why, int total, string rows);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Oriel could not delete the reading data of user {UserId}: its store is unavailable; the next start removes it")]
    private static partial void LogStoreUnavailable(ILogger logger, Guid userId);
}
