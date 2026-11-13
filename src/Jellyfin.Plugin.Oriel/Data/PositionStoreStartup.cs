using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// Opens the position store when the server starts and brings its schema up to date.
/// A store that cannot be opened is logged and left alone, so Jellyfin still starts.
/// </summary>
public partial class PositionStoreStartup : IHostedService
{
    private readonly PositionStore _store;
    private readonly ILogger<PositionStoreStartup> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="PositionStoreStartup"/> class.
    /// </summary>
    /// <param name="store">The position store.</param>
    /// <param name="logger">The logger.</param>
    public PositionStoreStartup(PositionStore store, ILogger<PositionStoreStartup> logger)
    {
        _store = store;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            var version = _store.Migrate((from, to) => LogMigrated(_logger, from, to));
            _logger.LogInformation("Oriel reading position store is at schema version {Version}", version);
        }
        catch (Exception exception)
        {
            _logger.LogCritical(
                exception,
                "Oriel cannot open its reading data store at {Path}: {Reason}. Oriel's reading data is unavailable until the file is fixed; nothing in its folder was changed",
                _store.DatabasePath,
                exception.Message);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    [LoggerMessage(Level = LogLevel.Information, Message = "Oriel's reading data store moved from schema version {From} to {To}")]
    private static partial void LogMigrated(ILogger logger, int from, int to);
}
