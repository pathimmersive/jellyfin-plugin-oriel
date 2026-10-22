using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;

namespace Jellyfin.Plugin.Oriel.Integration;

/// <summary>
/// Calls the File Transformation plugin by reflection. Plugins load into separate
/// contexts, so it cannot be referenced at build time; when it is not installed
/// every call is a no-op.
/// </summary>
public class FileTransformationBridge
{
    /// <summary>
    /// The File Transformation 3.x type that takes registrations.
    /// </summary>
    public const string InterfaceTypeName = "Jellyfin.Plugin.FileTransformation.PluginInterface";

    private readonly Func<IEnumerable<Assembly>> _assemblies;

    /// <summary>
    /// Initializes a new instance of the <see cref="FileTransformationBridge"/> class
    /// that looks in every loaded assembly.
    /// </summary>
    public FileTransformationBridge()
        : this(() => AssemblyLoadContext.All.SelectMany(context => context.Assemblies))
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="FileTransformationBridge"/> class
    /// that looks only in the given assemblies.
    /// </summary>
    /// <param name="assemblies">The assemblies to search.</param>
    public FileTransformationBridge(Func<IEnumerable<Assembly>> assemblies)
    {
        _assemblies = assemblies;
    }

    /// <summary>
    /// Gets a value indicating whether File Transformation is loaded.
    /// </summary>
    public bool IsAvailable => FindInterface() is not null;

    /// <summary>
    /// Registers a <see cref="TransformCallbacks"/> method for files under /web/ matching a pattern.
    /// </summary>
    /// <param name="id">The registration id.</param>
    /// <param name="fileNamePattern">A regular expression for the path under /web/.</param>
    /// <param name="callbackMethod">The name of a <see cref="TransformCallbacks"/> method.</param>
    /// <returns>Whether File Transformation took the registration.</returns>
    public bool Register(Guid id, string fileNamePattern, string callbackMethod)
    {
        var register = FindInterface()?.GetMethod("RegisterTransformation", BindingFlags.Public | BindingFlags.Static);
        // The payload is a Newtonsoft JObject; build it through the parameter's own Parse.
        var payloadType = register?.GetParameters() is [var parameter] ? parameter.ParameterType : null;
        var parse = payloadType?.GetMethod("Parse", BindingFlags.Public | BindingFlags.Static, [typeof(string)]);
        if (register is null || parse is null)
        {
            return false;
        }

        var json = JsonSerializer.Serialize(new Dictionary<string, string?>
        {
            ["id"] = id.ToString(),
            ["fileNamePattern"] = fileNamePattern,
            ["callbackAssembly"] = typeof(TransformCallbacks).Assembly.FullName,
            ["callbackClass"] = typeof(TransformCallbacks).FullName,
            ["callbackMethod"] = callbackMethod,
        });
        register.Invoke(null, [parse.Invoke(null, [json])]);
        return true;
    }

    /// <summary>
    /// Removes a registration.
    /// </summary>
    /// <param name="id">The registration id.</param>
    /// <returns>Whether File Transformation was there to remove it.</returns>
    public bool Remove(Guid id)
    {
        var remove = FindInterface()?.GetMethod("RemoveTransformation", BindingFlags.Public | BindingFlags.Static, [typeof(Guid)]);
        if (remove is null)
        {
            return false;
        }

        remove.Invoke(null, [id]);
        return true;
    }

    private Type? FindInterface() =>
        _assemblies().Select(assembly => assembly.GetType(InterfaceTypeName, throwOnError: false)).FirstOrDefault(type => type is not null);
}
