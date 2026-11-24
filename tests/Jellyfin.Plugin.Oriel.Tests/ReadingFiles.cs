using System.IO;
using System.Threading;
using Jellyfin.Plugin.Oriel.Data;

namespace Jellyfin.Plugin.Oriel.Tests;

// Reading data files as bytes, through the streams the endpoints use.
internal static class ReadingFiles
{
    public static byte[] Serialize(ReadingDataFile file)
    {
        using var stream = new MemoryStream();
        ReadingData.WriteAsync(stream, file, CancellationToken.None).GetAwaiter().GetResult();
        return stream.ToArray();
    }

    public static ReadingDataFile? Parse(byte[] json) => Parse(json, out _);

    public static ReadingDataFile? Parse(byte[] json, out string? reason)
    {
        using var stream = new MemoryStream(json);
        (var file, reason) = ReadingData.ReadAsync(stream).GetAwaiter().GetResult();
        return file;
    }
}
