# Finance Hub

Personal finance manager for a home server: net worth from account balances, budgeting from imported bank statements, and (in later releases) credit card and bank bonus tracking, investment cost base tracking, and spend forecasting. Single container, SQLite, installable PWA.

Current release: see `CHANGELOG.md`. What the app does today: `docs/functional-spec.md`.

## Run locally

```
npm ci
export APP_SECRET_KEY=$(openssl rand -hex 32)
DATA_DIR=./data COOKIE_SECURE=false PORT=8070 npm start
```

Open http://localhost:8070 (installing as an app needs https). The first visit asks you to create a login and set up an authenticator app.

```
npm test
```

## Docker

Release images are built by the `release` workflow when a `vX.Y.Z` tag is pushed and published as `mybadreligon/finance-hub`. Server deployment files are in `deploy/` (`compose.yaml`, `.env.example`, `RELEASE.md`).

Data lives under `/data` (SQLite and backups) and `/files` (statements). The container runs as uid 1000, gid 100.
