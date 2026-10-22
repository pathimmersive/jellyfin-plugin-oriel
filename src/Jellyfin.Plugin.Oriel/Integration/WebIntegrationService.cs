using System;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Configuration;
using MediaBrowser.Model.Plugins;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Oriel.Integration;

/// <summary>
/// Keeps the jellyfin-web patches registered with File Transformation while
/// <see cref="PluginConfiguration.EnableWebIntegration"/> is on, and only then.
/// </summary>
public sealed class WebIntegrationService : IHostedService
{
    /// <summary>
    /// The registration id of the index.html patch.
    /// </summary>
    public static readonly Guid IndexTransformationId = new("6f0c3a51-2a8e-4c39-9d7e-3b1f7c2e8a41");

    /// <summary>
    /// The registration id of the config.json patch.
    /// </summary>
    public static readonly Guid ConfigTransformationId = new("b8d1e0f4-5c27-4a6b-8e93-0a4d6f1c9b72");

    private readonly FileTransformationBridge _bridge;
    private readonly ILogger<WebIntegrationService> _logger;
    private readonly Lock _lock = new();
    private bool _registered;

    /// <summary>
    /// Initializes a new instance of the <see cref="WebIntegrationService"/> class.
    /// </summary>
    /// <param name="bridge">The File Transformation bridge.</param>
    /// <param name="logger">The logger.</param>
    public WebIntegrationService(FileTransformationBridge bridge, ILogger<WebIntegrationService> logger)
    {
        _bridge = bridge;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_bridge.IsAvailable)
        {
            _logger.LogInformation("File Transformation 3.x is not installed, so the jellyfin-web integration is unavailable. The reader at /Oriel/ is unaffected.");
        }

        if (Plugin.Instance is { } plugin)
        {
            plugin.ConfigurationChanged += OnConfigurationChanged;
            Apply(plugin.Configuration);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken)
    {
        if (Plugin.Instance is { } plugin)
        {
            plugin.ConfigurationChanged -= OnConfigurationChanged;
        }

        return Task.CompletedTask;
    }

    /// <summary>
    /// Registers or removes the patches to match the configuration.
    /// </summary>
    /// <param name="configuration">The plugin configuration.</param>
    public void Apply(PluginConfiguration configuration)
    {
        lock (_lock)
        {
            if (configuration.EnableWebIntegration == _registered)
            {
                return;
            }

            try
            {
                if (configuration.EnableWebIntegration)
                {
                    Register();
                }
                else
                {
                    _bridge.Remove(IndexTransformationId);
                    _bridge.Remove(ConfigTransformationId);
                    _registered = false;
                    _logger.LogInformation("jellyfin-web integration off");
                }
            }
            catch (Exception exception)
            {
                // A File Transformation change can only break the integration, never the plugin.
                _logger.LogError(exception, "Updating the jellyfin-web integration with File Transformation failed");
            }
        }
    }

    private void Register()
    {
        if (!_bridge.IsAvailable)
        {
            _logger.LogWarning("The jellyfin-web integration is on, but File Transformation 3.x is not installed; jellyfin-web is unchanged.");
            return;
        }

        if (_bridge.Register(IndexTransformationId, "^index\\.html$", nameof(TransformCallbacks.Index))
            && _bridge.Register(ConfigTransformationId, "^config\\.json$", nameof(TransformCallbacks.Config)))
        {
            _registered = true;
            _logger.LogInformation("jellyfin-web integration on: Play on EPUB items opens Oriel");
        }
        else
        {
            _logger.LogWarning("File Transformation is loaded but did not accept the registration; jellyfin-web is unchanged.");
        }
    }

    private void OnConfigurationChanged(object? sender, BasePluginConfiguration configuration)
    {
        if (configuration is PluginConfiguration oriel)
        {
            Apply(oriel);
        }
    }
}
