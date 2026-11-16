# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub instead: on this repository's **Security** tab, choose **Report a vulnerability**. Only the maintainers can see the report.

Include what is affected, the Jellyfin server version and the Oriel version or commit, and the steps to reproduce it. You will get a reply in the report, and the fix and its advisory are coordinated there.

## Supported versions

Oriel has no release yet. Fixes go into `main`; once releases exist, the latest release is supported.

## Scope

Oriel runs inside the Jellyfin server and serves a reader page that uses the signed-in user's Jellyfin session. Problems in Jellyfin itself belong with that project.

The README's [Privacy and security](README.md#privacy-and-security) section covers:
- what Oriel keeps;
- what it sends to other sites;
- how it treats the books it shows.

Reports are welcome about:
- a way for one user to reach another's reading data;
- a way for anything in a book to run, load from another site or reach the reader;
- any break of what that section promises.
