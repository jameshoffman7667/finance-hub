# Release v0.9.0
Image: mybadreligon/finance-hub:0.9.0   (built when this version is pushed to main; the workflow also creates the v0.9.0 tag and release, then the android job attaches finance-hub-0.9.0.apk)
Short: Add Android app and Back button support
Long: Android app (TWA) for the F-Droid repo: signed APK built on release, assetlinks.json served without login. Android Back now closes dialogs instead of leaving the screen. Needs the key secrets; first APK untested. P-33.
Type: minor (Android app, Back-button handling, one public file). Pending entries built: P-33.
Host port: 8070 (PORT_HOST=8070)   Container port: 8070 (same; the app reads PORT)
Public hostname: unchanged   Needs Caddy route: no (unchanged)
New env vars: none.
Data: none (no schema change). The image now serves /.well-known/assetlinks.json (public, static, package id and public certificate fingerprint only).
Network: the app makes outbound requests only when you press a button (Sync receipts, Check page, Read feed). Web pages are fetched over https only, never to private addresses, and only if the site's robots.txt allows it. Paperless is called on the address you configure.
Resources: unchanged. Healthcheck: GET /healthz -> 200 {"status":"ok","version":"0.9.0"} (unchanged).
Verify after deploy:
 0. `curl -s https://finances.hoffmanhouse.ca/.well-known/assetlinks.json` (after the Access bypass) returns the package and fingerprint.
 1. `docker ps` healthy; `wget -qO- http://127.0.0.1:8070/healthz` shows 0.9.0.
 2. With paperless set: Budget > Receipts > Sync now reports documents read; from the container, `wget -qO- $PAPERLESS_URL/api/` should answer (if not, fix the address or Docker network).
 3. Cards and bonuses > Watchlist: add an offer, press Check page on one with a web address.
PWA: manifest and install unchanged; cache name finance-hub-v0.9.0; shell cache lists watch.js and receipts.js. Layouts checked locally in Chromium at 390x844 and 1440x900: no horizontal scroll.
Rollback: previous image tag 0.6.0. The new tables stay and are ignored by 0.6.0.
Known issues: charges are matched by the amount the card posted, so a foreign-currency receipt will not match on its own (link it by hand); receipts without a readable total are listed but not matched; the uuid advisory in exceljs (moderate) is not reachable here and is left; paperless and live web pages were tested only against local mock servers; real Docker build was not run in the authoring environment, so confirm the container starts healthy after deploy.
Backup tier: small/critical (Tier 1).
Android: package ca.hoffmanhouse.financehub, versionCode 90000, key alias financehub, host finances.hoffmanhouse.ca. First F-Droid APK UNTESTED until James confirms it on his phone. The android job skips (green notice naming the missing secrets) until the four ANDROID_* secrets exist. Cloudflare Access bypass still needed: /.well-known/assetlinks.json (already allowed: /manifest.webmanifest, /sw.js, /icons/*).
