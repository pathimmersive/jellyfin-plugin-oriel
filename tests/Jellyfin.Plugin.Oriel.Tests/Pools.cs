using System.IO;
using Jellyfin.Plugin.Oriel.Data;

namespace Jellyfin.Plugin.Oriel.Tests;

/// <summary>
/// Lets go of the pooled connections to the databases under a test's folder. Test classes run in
/// parallel, so clearing every pool would close connections other tests are using.
/// </summary>
internal static class Pools
{
    public static void Release(string folder)
    {
        if (!Directory.Exists(folder))
        {
            return;
        }

        foreach (var database in Directory.GetFiles(folder, "*.db", SearchOption.AllDirectories))
        {
            OrielDatabase.ReleaseConnections(database);
        }
    }
}
