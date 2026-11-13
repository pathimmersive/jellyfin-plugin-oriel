using System;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// Thrown when adding a bookmark or highlight would take a user past the most the store keeps.
/// </summary>
public class LimitReachedException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="LimitReachedException"/> class.
    /// </summary>
    public LimitReachedException()
        : this("annotations")
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="LimitReachedException"/> class.
    /// </summary>
    /// <param name="limit">The limit reached: bookmarks or highlights.</param>
    public LimitReachedException(string limit)
        : base($"The most {limit} a user keeps has been reached.")
    {
        Limit = limit;
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="LimitReachedException"/> class.
    /// </summary>
    /// <param name="limit">The limit reached: bookmarks or highlights.</param>
    /// <param name="innerException">The failure behind it.</param>
    public LimitReachedException(string limit, Exception innerException)
        : base($"The most {limit} a user keeps has been reached.", innerException)
    {
        Limit = limit;
    }

    /// <summary>
    /// Gets the limit reached: bookmarks or highlights.
    /// </summary>
    public string Limit { get; }
}
