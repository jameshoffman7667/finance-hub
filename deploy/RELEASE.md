# Release v0.1.0
Image: mybadreligon/finance-hub:0.1.0   (built by the v0.1.0 tag workflow)
Short: Add foundation: login, accounts, CSV import
Long: First release. Two-step login, accounts and balances, CSV statement import with preview and rollback, categories and rules, spending and net worth views, installable PWA for phone and desktop.
Type: minor (first release of a new app; baseline 0.1.0)
Host port: TBD (assign from port register; web apps 8070-8099)   Container port: 8080
Public hostname: finance-hub.hoffmanhouse.ca (Cloudflare Tunnel, protected by Cloudflare Access)   Needs Caddy route: yes
New or changed env vars: all new. Required secret: APP_SECRET_KEY (32+ chars, `openssl rand -hex 32`). Also APP_URL=https://finance-hub.hoffmanhouse.ca, COOKIE_SECURE=true, optional CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (set after the Access app exists), PORT_HOST. Others optional, see deploy/.env.example.
Data: /data (fast storage: SQLite + backups) and /files (slow pool, reserved). Create `<FAST_STORAGE>/finance-hub` and `<SLOW_STORAGE>/finance-hub` owned by uid 1000, gid 100 (container user is 1000:100). Migration: schema 1 creates all tables; none to reverse. Keep APP_SECRET_KEY safe: without it the stored authenticator key cannot be read.
Resources: expected idle RAM 80-120 MB, CPU near zero; argon2 sign-in uses about 20 MB for a moment. No limits needed (optional mem_limit 256m).
Healthcheck: GET /healthz -> 200 {status, version}
Verify after deploy:
 1. `docker ps` shows finance-hub healthy and `curl http://<host>:<PORT>/healthz` returns {"status":"ok","version":"0.1.0"}.
 2. Open https://finance-hub.hoffmanhouse.ca (pass Cloudflare Access), create the login, scan or type the authenticator key, finish setup, add an account and a balance (reads and writes real data).
 3. Import a small CSV from Accounts and imports, check it appears under Budget, then Settings > Export works after re-entering the password.
 4. Check Cloudflare Access does not block /manifest.webmanifest, /sw.js or /icons/* (add a Bypass policy for those paths if it does), then install the app on phone and desktop.
PWA: installable on phone and desktop at https://finance-hub.hoffmanhouse.ca (manifest ok, service worker registered, offline page works: verified locally over http://localhost with Chromium). Layouts checked at 390x844, 768x1024, 1440x900 (also 320 px: no horizontal scroll). Lighthouse PWA result: not run.
Rollback: first release, nothing to roll back to; remove the stack. Data restore needed: no.
Known issues: no QR code for the authenticator (type the key or tap the otpauth link); rate limiting resets on restart; no email alerts yet; CSV only. The authoring environment could not pull base images from Docker Hub, so a local `docker build` was NOT run; the first build is the tag workflow, and the image should be confirmed to start (healthy) before relying on it.
Backup tier: small/critical (include in Tier 1). SQLite needs the container stopped during a file copy (or copy .db, -wal and -shm together).
