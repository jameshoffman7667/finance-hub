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

A release is a commit pushed to `main` that changes `version` in `package.json` (with a matching `CHANGELOG.md` entry). The `release` workflow then builds and pushes `mybadreligon/finance-hub:X.Y.Z`, `:X.Y` and `:latest`, and creates the GitHub release and the `vX.Y.Z` tag itself, so nobody pushes a tag. Pushing a `vX.Y.Z` tag by hand still works as a manual fallback; the workflow refuses to release a version twice. Server deployment files are in `deploy/` (`compose.yaml`, `.env.example`, `RELEASE.md`).

Data lives under `/data` (SQLite and backups) and `/files` (statements). The container runs as uid 1000, gid 100.
