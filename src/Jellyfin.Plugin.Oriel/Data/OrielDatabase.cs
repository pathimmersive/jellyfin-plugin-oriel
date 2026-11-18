using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using Microsoft.Data.Sqlite;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// The plugin's own SQLite database: it opens the file, keeps its schema current, runs transactions, and
/// deletes or lists users. Each kind of data is read and written by its own store through it.
/// </summary>
public class OrielDatabase
{
    /// <summary>
    /// How long a connection waits for another's lock before failing, in milliseconds.
    /// </summary>
    public const int BusyTimeoutMilliseconds = 5000;

    /// <summary>
    /// The schema, one step per version: entry n moves the database from version n to n + 1.
    /// </summary>
    public static readonly IReadOnlyList<string> Schema =
    [
        """
        CREATE TABLE positions (
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            cfi TEXT NOT NULL,
            fraction REAL NOT NULL,
            saved_at TEXT NOT NULL,
            PRIMARY KEY (user_id, item_id)
        )
        """,
        """
        CREATE TABLE bookmarks (
            id TEXT NOT NULL PRIMARY KEY,
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            cfi TEXT NOT NULL,
            fraction REAL NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (user_id, item_id, cfi)
        )
        """,
        """
        CREATE TABLE highlights (
            id TEXT NOT NULL PRIMARY KEY,
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            cfi TEXT NOT NULL,
            fraction REAL NOT NULL,
            colour TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (user_id, item_id, cfi)
        )
        """,
        "ALTER TABLE highlights ADD COLUMN note TEXT NOT NULL DEFAULT ''",
        """
        CREATE TABLE highlighters (
            user_id TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            colour TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        )
        """,
        """
        CREATE TABLE fonts (
            id TEXT NOT NULL PRIMARY KEY,
            user_id TEXT NOT NULL,
            family TEXT NOT NULL,
            style TEXT NOT NULL,
            weight INTEGER NOT NULL,
            italic INTEGER NOT NULL,
            format TEXT NOT NULL,
            data BLOB NOT NULL,
            added_at TEXT NOT NULL,
            UNIQUE (user_id, family, weight, italic)
        )
        """,
        """
        CREATE TABLE themes (
            user_id TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            colours TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        )
        """,
        """
        CREATE TABLE choices (
            user_id TEXT NOT NULL PRIMARY KEY,
            theme TEXT NOT NULL,
            font TEXT NOT NULL
        )
        """,
    ];

    /// <summary>
    /// The tables that hold a user's data, each with a user_id column.
    /// </summary>
    public static readonly IReadOnlyList<string> UserTables = ["positions", "bookmarks", "highlights", "highlighters", "fonts", "themes", "choices"];

    private readonly string _connectionString;
    private readonly string _databasePath;
    private readonly IReadOnlyList<string> _migrations;
    private readonly object _migrateLock = new();
    private readonly AsyncLocal<SharedTransaction?> _shared = new();
    private bool _migrated;

    /// <summary>
    /// Initializes a new instance of the <see cref="OrielDatabase"/> class.
    /// </summary>
    /// <param name="databasePath">The database file; its folder is created when the database is first opened.</param>
    public OrielDatabase(string databasePath)
        : this(databasePath, Schema)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="OrielDatabase"/> class with a given schema.
    /// </summary>
    /// <param name="databasePath">The database file; its folder is created when the database is first opened.</param>
    /// <param name="migrations">The schema steps, oldest first.</param>
    public OrielDatabase(string databasePath, IReadOnlyList<string> migrations)
    {
        _databasePath = databasePath;
        _connectionString = ConnectionString(databasePath);
        _migrations = migrations;
    }

    /// <summary>
    /// Gets the database file.
    /// </summary>
    public string DatabasePath => _databasePath;

    /// <summary>
    /// Brings the database up to the current schema, applying each missing step in order.
    /// </summary>
    /// <returns>The schema version afterwards.</returns>
    /// <exception cref="InvalidOperationException">The database is at a schema newer than this plugin's.</exception>
    public int Migrate() => Migrate(null);

    /// <summary>
    /// Brings the database up to the current schema as <see cref="Migrate()"/> does, telling <paramref name="applied"/> each step.
    /// </summary>
    /// <param name="applied">Called with the version before and after each step applied.</param>
    /// <returns>The schema version afterwards.</returns>
    /// <exception cref="InvalidOperationException">The database is at a schema newer than this plugin's.</exception>
    public int Migrate(Action<int, int>? applied)
    {
        lock (_migrateLock)
        {
            var folder = Path.GetDirectoryName(Path.GetFullPath(_databasePath));
            if (!string.IsNullOrEmpty(folder))
            {
                Directory.CreateDirectory(folder);
            }

            using var connection = OpenConnection();
            try
            {
                Execute(connection, "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
                using (var read = connection.CreateCommand())
                {
                    read.CommandText = "SELECT version FROM schema_version";
                    var current = read.ExecuteScalar() is long stored ? (int)stored : 0;
                    if (current > _migrations.Count)
                    {
                        throw new InvalidOperationException(
                            $"The reading position database is at schema version {current}, newer than this plugin's {_migrations.Count}.");
                    }

                    // Only a file at a schema this plugin reads is switched to WAL; a newer one is left as it is.
                    Execute(connection, "PRAGMA journal_mode = wal");
                    for (var version = current; version < _migrations.Count; version++)
                    {
                        using var transaction = connection.BeginTransaction();
                        Execute(connection, _migrations[version]);
                        Execute(connection, "DELETE FROM schema_version");
                        Execute(connection, $"INSERT INTO schema_version (version) VALUES ({version + 1})");
                        transaction.Commit();
                        applied?.Invoke(version, version + 1);
                    }
                }
            }
            catch
            {
                // A file Oriel cannot use must not stay open in the pool: an admin replacing or removing it
                // while Jellyfin runs could not, on Windows, and the next try must open it afresh.
                SqliteConnection.ClearPool(connection);
                throw;
            }

            _migrated = true;
            return _migrations.Count;
        }
    }

    /// <summary>
    /// Deletes every row the database keeps for a user, in one transaction.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>How many rows went from each table, by table name.</returns>
    public IReadOnlyDictionary<string, int> DeleteUser(Guid userId)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var removed = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var table in UserTables)
        {
            using var delete = connection.CreateCommand();
            delete.CommandText = $"DELETE FROM {table} WHERE user_id = $user";
            delete.Parameters.AddWithValue("$user", Key(userId));
            removed[table] = delete.ExecuteNonQuery();
        }

        transaction.Commit();
        return removed;
    }

    /// <summary>
    /// Gets every user the database keeps any data for.
    /// </summary>
    /// <returns>The users.</returns>
    public IReadOnlyList<Guid> UserIds()
    {
        using var connection = Open();
        using var read = connection.CreateCommand();
        read.CommandText = string.Join(" UNION ", UserTables.Select(table => $"SELECT user_id FROM {table}"));
        using var reader = read.ExecuteReader();
        var users = new List<Guid>();
        while (reader.Read())
        {
            if (Guid.TryParse(reader.GetString(0), out var userId))
            {
                users.Add(userId);
            }
        }

        return users;
    }

    /// <summary>
    /// Runs work against the database in one transaction on one connection: every store method it calls
    /// uses them, and nothing it wrote is kept unless all of it succeeds.
    /// </summary>
    /// <typeparam name="T">What the work returns.</typeparam>
    /// <param name="work">The work.</param>
    /// <returns>What the work returned.</returns>
    public T RunInTransaction<T>(Func<T> work)
    {
        if (_shared.Value is not null)
        {
            return work();
        }

        EnsureMigrated();
        using var connection = OpenConnection();
        Execute(connection, "BEGIN IMMEDIATE");
        _shared.Value = new SharedTransaction(connection);
        try
        {
            var result = work();
            Execute(connection, "COMMIT");
            return result;
        }
        catch
        {
            try
            {
                Execute(connection, "ROLLBACK");
            }
            catch (SqliteException)
            {
                // SQLite has already rolled back after some errors (a full disk, an I/O error); the
                // error that stopped the work is the one to report.
            }

            throw;
        }
        finally
        {
            _shared.Value = null;
        }
    }

    /// <summary>
    /// Opens the database for one store method: the connection <see cref="RunInTransaction{T}"/> shares while
    /// it runs, else one of its own. The database is opened and migrated on first use; while it cannot be,
    /// every use fails as unavailable and tries again.
    /// </summary>
    /// <returns>The connection, to dispose when done.</returns>
    /// <exception cref="StoreUnavailableException">The database cannot be opened or migrated.</exception>
    internal StoreConnection Open()
    {
        EnsureMigrated();
        return _shared.Value is { } shared ? new StoreConnection(shared) : new StoreConnection(OpenConnection());
    }

    /// <summary>
    /// Gets the key a user or book id is stored under.
    /// </summary>
    /// <param name="id">The id.</param>
    /// <returns>The id as 32 hex digits.</returns>
    internal static string Key(Guid id) => id.ToString("N", CultureInfo.InvariantCulture);

    /// <summary>
    /// Writes a time as it is stored.
    /// </summary>
    /// <param name="time">The time.</param>
    /// <returns>The round-trip ISO 8601 form.</returns>
    internal static string Time(DateTimeOffset time) => time.ToString("O", CultureInfo.InvariantCulture);

    /// <summary>
    /// Reads a stored time.
    /// </summary>
    /// <param name="reader">The row.</param>
    /// <param name="column">The column.</param>
    /// <returns>The time.</returns>
    internal static DateTimeOffset Time(SqliteDataReader reader, int column) =>
        DateTimeOffset.Parse(reader.GetString(column), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    /// <summary>
    /// Runs a statement that returns nothing.
    /// </summary>
    /// <param name="connection">The connection.</param>
    /// <param name="sql">The statement.</param>
    internal static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    /// <summary>
    /// Closes the pooled connections to one database file and to no other, so the file can be removed.
    /// </summary>
    /// <param name="databasePath">The database file.</param>
    internal static void ReleaseConnections(string databasePath)
    {
        using var connection = new SqliteConnection(ConnectionString(databasePath));
        SqliteConnection.ClearPool(connection);
    }

    // Connections are kept open between uses: opening one per use costs about ten times as much, and
    // closing the last one checkpoints and deletes the write-ahead log every time.
    private static string ConnectionString(string databasePath) => new SqliteConnectionStringBuilder
    {
        DataSource = databasePath,
        Mode = SqliteOpenMode.ReadWriteCreate,
        Pooling = true,
    }.ToString();

    /// <summary>
    /// Opens a connection that waits <see cref="BusyTimeoutMilliseconds"/> for a lock.
    /// </summary>
    /// <returns>The open connection.</returns>
    internal SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        Execute(connection, $"PRAGMA busy_timeout = {BusyTimeoutMilliseconds}");
        return connection;
    }

    private void EnsureMigrated()
    {
        if (_migrated)
        {
            return;
        }

        try
        {
            Migrate();
        }
        catch (Exception exception)
        {
            throw new StoreUnavailableException($"Oriel's reading data store at {_databasePath} cannot be opened: {exception.Message}", exception);
        }
    }
}

/// <summary>
/// A connection lent to one store method, with transactions begun in SQL so they nest inside a shared one.
/// </summary>
internal sealed class StoreConnection : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly SharedTransaction? _shared;

    /// <summary>
    /// Initializes a new instance of the <see cref="StoreConnection"/> class on a connection of its own.
    /// </summary>
    /// <param name="connection">The connection, closed when this is disposed.</param>
    public StoreConnection(SqliteConnection connection)
    {
        _connection = connection;
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="StoreConnection"/> class inside a shared transaction.
    /// </summary>
    /// <param name="shared">The shared transaction.</param>
    public StoreConnection(SharedTransaction shared)
    {
        _connection = shared.Connection;
        _shared = shared;
    }

    /// <summary>
    /// Creates a command on the connection.
    /// </summary>
    /// <returns>The command.</returns>
    public SqliteCommand CreateCommand() => _connection.CreateCommand();

    /// <summary>
    /// Begins a <c>BEGIN IMMEDIATE</c> transaction on a connection of its own, or a savepoint inside a shared transaction.
    /// </summary>
    /// <returns>The transaction, rolled back when disposed without being committed.</returns>
    public StoreTransaction BeginTransaction()
    {
        if (_shared is null)
        {
            OrielDatabase.Execute(_connection, "BEGIN IMMEDIATE");
            return new StoreTransaction(_connection, "COMMIT", "ROLLBACK");
        }

        var name = $"oriel_{++_shared.Savepoints}";
        OrielDatabase.Execute(_connection, $"SAVEPOINT {name}");
        return new StoreTransaction(_connection, $"RELEASE {name}", $"ROLLBACK TO {name}; RELEASE {name}");
    }

    /// <summary>
    /// Whether a user has a row in a table for a book at a CFI.
    /// </summary>
    /// <param name="table">The table.</param>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="cfi">The CFI.</param>
    /// <returns>True when there is one.</returns>
    public bool Exists(string table, Guid userId, Guid itemId, string cfi)
    {
        using var command = CreateCommand();
        command.CommandText = $"SELECT EXISTS (SELECT 1 FROM {table} WHERE user_id = $user AND item_id = $item AND cfi = $cfi)";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        command.Parameters.AddWithValue("$cfi", cfi);
        return (long)command.ExecuteScalar()! != 0;
    }

    /// <summary>
    /// How many rows a user has in a table; inside a shared transaction, counted once and kept up to date as rows are added.
    /// </summary>
    /// <param name="table">The table.</param>
    /// <param name="userId">The user.</param>
    /// <returns>The count.</returns>
    public long Count(string table, Guid userId)
    {
        if (_shared is not null && _shared.Counts.TryGetValue((table, userId), out var known))
        {
            return known;
        }

        using var command = CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM {table} WHERE user_id = $user";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        var count = (long)command.ExecuteScalar()!;
        if (_shared is not null)
        {
            _shared.Counts[(table, userId)] = count;
        }

        return count;
    }

    /// <summary>
    /// Notes that a row was added to a table for a user, so a shared transaction's count stays right.
    /// </summary>
    /// <param name="table">The table.</param>
    /// <param name="userId">The user.</param>
    /// <param name="rows">How many rows were added.</param>
    public void Added(string table, Guid userId, int rows = 1)
    {
        if (_shared is not null && _shared.Counts.TryGetValue((table, userId), out var count))
        {
            _shared.Counts[(table, userId)] = count + rows;
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_shared is null)
        {
            _connection.Dispose();
        }
    }
}

/// <summary>
/// The connection and transaction <see cref="OrielDatabase.RunInTransaction{T}"/> shares, with the row counts read in it.
/// </summary>
/// <param name="connection">The connection.</param>
internal sealed class SharedTransaction(SqliteConnection connection)
{
    /// <summary>
    /// Gets the connection.
    /// </summary>
    public SqliteConnection Connection { get; } = connection;

    /// <summary>
    /// Gets the row counts read in the transaction, by table and user.
    /// </summary>
    public Dictionary<(string Table, Guid UserId), long> Counts { get; } = [];

    /// <summary>
    /// Gets or sets how many savepoints have been made in it.
    /// </summary>
    public int Savepoints { get; set; }
}

/// <summary>
/// A transaction or savepoint, rolled back when disposed without being committed.
/// </summary>
internal sealed class StoreTransaction : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly string _commit;
    private readonly string _rollback;
    private bool _done;

    /// <summary>
    /// Initializes a new instance of the <see cref="StoreTransaction"/> class.
    /// </summary>
    /// <param name="connection">The connection.</param>
    /// <param name="commit">The SQL that commits it.</param>
    /// <param name="rollback">The SQL that rolls it back.</param>
    public StoreTransaction(SqliteConnection connection, string commit, string rollback)
    {
        _connection = connection;
        _commit = commit;
        _rollback = rollback;
    }

    /// <summary>
    /// Commits it.
    /// </summary>
    public void Commit()
    {
        OrielDatabase.Execute(_connection, _commit);
        _done = true;
    }

    /// <summary>
    /// Rolls it back.
    /// </summary>
    public void Rollback()
    {
        OrielDatabase.Execute(_connection, _rollback);
        _done = true;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (!_done)
        {
            Rollback();
        }
    }
}
