using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// Opens the database when the server starts and brings its schema up to date.
/// A database that cannot be opened is logged and left alone, so Jellyfin still starts.
/// </summary>
public partial class DatabaseStartup : IHostedService
{
    private readonly OrielDatabase _database;
    private readonly ILogger<DatabaseStartup> _logger;
    private readonly Func<IReadOnlyCollection<Guid>>? _users;

    /// <summary>
    /// Initializes a new instance of the <see cref="DatabaseStartup"/> class.
    /// </summary>
    /// <param name="database">The database.</param>
    /// <param name="logger">The logger.</param>
    /// <param name="userManager">Jellyfin's users, for removing the data of users deleted while Oriel was not loaded.</param>
    [ActivatorUtilitiesConstructor]
    public DatabaseStartup(OrielDatabase database, ILogger<DatabaseStartup> logger, IUserManager userManager)
        : this(database, logger, () => userManager.GetUsersIds().ToList())
    {
    }

    // The users Jellyfin has are a parameter so the tests can set them; without them there is no sweep.
    internal DatabaseStartup(OrielDatabase database, ILogger<DatabaseStartup> logger, Func<IReadOnlyCollection<Guid>>? users = null)
    {
        _database = database;
        _logger = logger;
        _users = users;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            var version = _database.Migrate((from, to) => LogMigrated(_logger, from, to));
            LogVersion(_logger, version);
            Sweep();
        }
        catch (Exception exception)
        {
            LogCannotOpen(_logger, exception, _database.DatabasePath, exception.Message);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    // Removes the data of users Jellyfin no longer has, deleted while Oriel was not loaded. An empty
    // list of users means Jellyfin's could not be read, not that there are none, so nothing is deleted.
    private void Sweep()
    {
        if (_users is null)
        {
            return;
        }

        var existing = _users().ToHashSet();
        if (existing.Count == 0)
        {
            LogNoUsers(_logger);
            return;
        }

        foreach (var userId in _database.UserIds().Where(userId => !existing.Contains(userId)))
        {
            UserDeletion.Delete(_database, _logger, userId, "no longer a Jellyfin user");
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Oriel reading position store is at schema version {Version}")]
    private static partial void LogVersion(ILogger logger, int version);

    [LoggerMessage(Level = LogLevel.Critical, Message = "Oriel cannot open its reading data store at {Path}: {Reason}. Oriel's reading data is unavailable until the file is fixed; nothing in its folder was changed")]
    private static partial void LogCannotOpen(ILogger logger, Exception exception, string path, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Oriel did not look for deleted users' reading data: Jellyfin listed no users")]
    private static partial void LogNoUsers(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Oriel's reading data store moved from schema version {From} to {To}")]
    private static partial void LogMigrated(ILogger logger, int from, int to);
}
