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
    private readonly PositionStore _store;
    private readonly ILogger<UserDeletion> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="UserDeletion"/> class.
    /// </summary>
    /// <param name="store">The position store.</param>
    /// <param name="logger">The logger.</param>
    public UserDeletion(PositionStore store, ILogger<UserDeletion> logger)
    {
        _store = store;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task OnEvent(UserDeletedEventArgs eventArgs)
    {
        ArgumentNullException.ThrowIfNull(eventArgs);
        Delete(_store, _logger, eventArgs.Argument.Id, "deleted in Jellyfin");
        return Task.CompletedTask;
    }

    /// <summary>
    /// Deletes a user's rows and logs how many of each kind went; a store that cannot be opened is logged and left alone.
    /// </summary>
    /// <param name="store">The position store.</param>
    /// <param name="logger">Where to log it.</param>
    /// <param name="userId">The user.</param>
    /// <param name="why">Why the user's data goes, for the log.</param>
    internal static void Delete(PositionStore store, ILogger logger, Guid userId, string why)
    {
        try
        {
            var removed = store.DeleteUser(userId);
            LogDeleted(logger, userId, why, removed.Values.Sum(), Describe(removed));
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
