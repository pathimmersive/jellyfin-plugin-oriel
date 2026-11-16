using System;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// Thrown when an import starts while another is still running on the server.
/// </summary>
public class ImportRunningException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="ImportRunningException"/> class.
    /// </summary>
    public ImportRunningException()
        : base("An import for this user is already running.")
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="ImportRunningException"/> class.
    /// </summary>
    /// <param name="message">What is wrong.</param>
    public ImportRunningException(string message)
        : base(message)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="ImportRunningException"/> class.
    /// </summary>
    /// <param name="message">What is wrong.</param>
    /// <param name="innerException">The failure behind it.</param>
    public ImportRunningException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
