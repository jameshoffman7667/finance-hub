# Changelog

Newest first. One entry per released version; entries are never rewritten.

## v0.1.1 - 2026-10-16
**Short:** Default port 8070; health checks follow PORT
**Long:** Port is now 8070 by default and set by PORT. The compose file publishes the host port as the container port and both health checks read PORT, so the image stays healthy when run outside our compose.

## v0.1.0 - 2026-10-16
**Short:** Add foundation: login, accounts, CSV import
**Long:** First release. Two-step login, accounts and balances, CSV statement import with preview and rollback, categories and rules, spending and net worth views, installable PWA for phone and desktop.
