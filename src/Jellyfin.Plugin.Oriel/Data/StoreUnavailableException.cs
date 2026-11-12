using System;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// Thrown by every use of the position store while its database cannot be opened or migrated.
/// </summary>
public class StoreUnavailableException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="StoreUnavailableException"/> class.
    /// </summary>
    public StoreUnavailableException()
        : base("Oriel's reading data store is unavailable.")
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="StoreUnavailableException"/> class.
    /// </summary>
    /// <param name="message">What is wrong.</param>
    public StoreUnavailableException(string message)
        : base(message)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="StoreUnavailableException"/> class.
    /// </summary>
    /// <param name="message">What is wrong.</param>
    /// <param name="innerException">Why the store could not be opened.</param>
    public StoreUnavailableException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
