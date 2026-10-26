# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub instead: on this repository's **Security** tab, choose **Report a vulnerability**. Only the maintainers can see the report.

Include what is affected, the Jellyfin server version and the Oriel version or commit, and the steps to reproduce it. You will get a reply in the report, and the fix and its advisory are coordinated there.

## Supported versions

Oriel has no release yet. Fixes go into `main`; once releases exist, the latest release is supported.

## Scope

Oriel runs inside the Jellyfin server and serves a reader page that uses the signed-in user's Jellyfin session. Problems in Jellyfin itself, or in the File Transformation plugin, belong with those projects.
