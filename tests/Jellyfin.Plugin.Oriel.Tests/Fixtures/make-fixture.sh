#!/usr/bin/env bash
# Freezes a database at the plugin's current schema, for the upgrade tests: the
# plugin's own stores write every kind of row for two users into
# schema-<N>.db here, and schema-<N>.json records each row as read back. Run it
# once per released schema, from a checkout of that release; an existing
# fixture is never written over.
#
# Usage: tests/Jellyfin.Plugin.Oriel.Tests/Fixtures/make-fixture.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
ORIEL_WRITE_FIXTURE="$here" dotnet test "$repo/tests/Jellyfin.Plugin.Oriel.Tests" --filter "FullyQualifiedName~UpgradeFixtureTests.WritesAFixtureWhenAsked"
ls -l "$here"/schema-*.db
