using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// A request body read only up to a limit, for the endpoints that take a file: a font or a reading data file.
/// </summary>
internal static class LimitedBody
{
    /// <summary>
    /// Wraps a body so that reading more than <paramref name="limit"/> bytes of it throws <see cref="BodyTooLargeException"/>.
    /// </summary>
    /// <param name="body">The request body.</param>
    /// <param name="limit">The most bytes it may have.</param>
    /// <returns>The body, read as it comes.</returns>
    public static Stream Limit(Stream body, long limit) => new LimitedStream(body, limit);

    /// <summary>
    /// Reads all of a body, stopping as soon as it has more than <paramref name="limit"/> bytes.
    /// </summary>
    /// <param name="body">The request body.</param>
    /// <param name="limit">The most bytes it may have.</param>
    /// <returns>Its bytes, or null when it has more than the limit.</returns>
    public static async Task<byte[]?> ReadAsync(Stream body, long limit)
    {
        using var copy = new MemoryStream();
        try
        {
            await Limit(body, limit).CopyToAsync(copy).ConfigureAwait(false);
        }
        catch (BodyTooLargeException)
        {
            return null;
        }

        return copy.ToArray();
    }

    // Reads a stream as it comes and throws once more than `limit` bytes of it have.
    private sealed class LimitedStream(Stream stream, long limit) : Stream
    {
        private long _read;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            _read += read;
            return _read > limit ? throw new BodyTooLargeException() : read;
        }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();
    }
}

/// <summary>
/// A request body had more bytes than its limit.
/// </summary>
internal sealed class BodyTooLargeException : Exception
{
}
