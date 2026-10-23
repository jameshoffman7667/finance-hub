# Changelog

Newest first. One entry per released version; entries are never rewritten.

## v0.1.3 - 2026-10-22
**Short:** Release by pushing main; no tag push needed
**Long:** The release workflow now runs on a push to main that changes the version in package.json, builds the images and creates the GitHub release and tag itself. The v*.*.* tag trigger stays as a manual fallback. Includes v0.1.2.

## v0.1.2 - 2026-10-22
**Short:** Health checks verify /healthz body; 30s start
**Long:** Image and compose health checks now require the /healthz body to report status ok, and wait 30 seconds before the first check. /healthz stays public, shows no private data and calls no outside service. Includes the v0.1.1 port change.

## v0.1.1 - 2026-10-16
**Short:** Default port 8070; health checks follow PORT
**Long:** Port is now 8070 by default and set by PORT. The compose file publishes the host port as the container port and both health checks read PORT, so the image stays healthy when run outside our compose.

## v0.1.0 - 2026-10-16
**Short:** Add foundation: login, accounts, CSV import
**Long:** First release. Two-step login, accounts and balances, CSV statement import with preview and rollback, categories and rules, spending and net worth views, installable PWA for phone and desktop.
