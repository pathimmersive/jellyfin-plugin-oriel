using System;
using System.Collections.Generic;
using System.Text.Json;

// A stand-in for the File Transformation plugin, under its namespace and type
// name so the bridge finds it the way it finds the real one.
namespace Jellyfin.Plugin.FileTransformation;

public sealed class FakePayload
{
    private FakePayload(Dictionary<string, string> values) => Values = values;

    public Dictionary<string, string> Values { get; }

    // Stands in for Newtonsoft's JObject.Parse, which the bridge finds on the parameter type.
    public static FakePayload Parse(string json) => new(JsonSerializer.Deserialize<Dictionary<string, string>>(json)!);
}

public static class PluginInterface
{
    public static Dictionary<Guid, Dictionary<string, string>> Registered { get; } = [];

    public static List<Guid> Removed { get; } = [];

    public static bool Fail { get; set; }

    public static void RegisterTransformation(FakePayload payload)
    {
        if (Fail)
        {
            throw new InvalidOperationException("registration refused");
        }

        Registered[Guid.Parse(payload.Values["id"])] = payload.Values;
    }

    public static void RemoveTransformation(Guid id)
    {
        Registered.Remove(id);
        Removed.Add(id);
    }

    public static void Reset()
    {
        Registered.Clear();
        Removed.Clear();
        Fail = false;
    }
}
