# Release v0.1.1
Image: mybadreligon/finance-hub:0.1.1   (built by the v0.1.1 tag workflow)
Short: Default port 8070; health checks follow PORT
Long: Port is now 8070 by default and set by PORT. The compose file publishes the host port as the container port and both health checks read PORT, so the image stays healthy when run outside our compose.
Type: patch (packaging change; no feature or data change)
Host port: 8070 (PORT_HOST=8070)   Container port: 8070 (same as the host port; the app reads PORT)
Public hostname: finance-hub.hoffmanhouse.ca (Cloudflare Tunnel, protected by Cloudflare Access)   Needs Caddy route: already added at first deploy (target port 8070)
New or changed env vars: PORT is now set by compose from PORT_HOST (default inside the image is 8070). No other changes.
Data: unchanged. /data (fast storage: SQLite + backups) and /files (slow pool, reserved). Create `<FAST_STORAGE>/finance-hub` and `<SLOW_STORAGE>/finance-hub` owned by uid 1000, gid 100 (container user is 1000:100). Migration: none. Keep APP_SECRET_KEY safe: without it the stored authenticator key cannot be read.
Resources: expected idle RAM 80-120 MB, CPU near zero; argon2 sign-in uses about 20 MB for a moment. No limits needed (optional mem_limit 256m).
Healthcheck: GET /healthz on $PORT -> 200 {status, version}; image HEALTHCHECK and compose both read PORT
Verify after deploy:
 1. `docker ps` shows finance-hub healthy and `curl http://<host>:8070/healthz` returns {"status":"ok","version":"0.1.1"}.
 2. Open https://finance-hub.hoffmanhouse.ca (pass Cloudflare Access), create the login, scan or type the authenticator key, finish setup, add an account and a balance (reads and writes real data).
 3. Import a small CSV from Accounts and imports, check it appears under Budget, then Settings > Export works after re-entering the password.
 4. Check Cloudflare Access does not block /manifest.webmanifest, /sw.js or /icons/* (add a Bypass policy for those paths if it does), then install the app on phone and desktop.
PWA: installable on phone and desktop at https://finance-hub.hoffmanhouse.ca (manifest ok, service worker registered, offline page works: verified locally over http://localhost with Chromium). Layouts checked at 390x844, 768x1024, 1440x900 (also 320 px: no horizontal scroll). Lighthouse PWA result: not run.
Rollback: previous image tag 0.1.0, but it listens on 8080: switch PORT and the port mapping back to 8080 too. Data restore needed: no.
Known issues: no QR code for the authenticator (type the key or tap the otpauth link); rate limiting resets on restart; no email alerts yet; CSV only. Docker build: not run locally (Docker Hub unreachable in the authoring environment); the tag workflow is the first build of this change, so confirm the container is healthy after deploy.
Backup tier: small/critical (include in Tier 1). SQLite needs the container stopped during a file copy (or copy .db, -wal and -shm together).
