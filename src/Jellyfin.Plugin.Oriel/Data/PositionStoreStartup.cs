using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// Opens the position store when the server starts and brings its schema up to date.
/// </summary>
public class PositionStoreStartup : IHostedService
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
        var version = _store.Migrate();
        _logger.LogInformation("Oriel reading position store is at schema version {Version}", version);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
