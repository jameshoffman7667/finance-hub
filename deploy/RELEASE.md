# Release v0.7.0
Image: mybadreligon/finance-hub:0.7.0   (built when this version is pushed to main; the workflow also creates the v0.7.0 tag and release)
Short: Add paperless receipts and offer watchlist
Long: Match card charges to paperless-ngx receipts (review, link, find charges with none). Watchlist for offers you spot: fetch a page or feed only when asked, compare by source. Nodemailer upgraded. Covers P-1 and P-9.
Type: minor (new features, new tables). Pending entries built: P-1, P-9.
Host port: 8070 (PORT_HOST=8070)   Container port: 8070 (same; the app reads PORT)
Public hostname: unchanged   Needs Caddy route: no (unchanged)
New env vars, all optional: PAPERLESS_URL (address of paperless-ngx the container can reach, for example its LAN address and port), PAPERLESS_TOKEN (API token from paperless; read access is enough), PAPERLESS_PUBLIC_URL (address used for receipt links in the browser; defaults to PAPERLESS_URL), PAPERLESS_TOTAL_FIELD (name of the paperless custom field holding the total; default Total). Leave PAPERLESS_URL empty to keep receipts off. Put the token in the server .env only. ALLOW_PRIVATE_FETCH exists for tests only: do not set it. Cloudflare: unchanged.
Data: schema 6 -> 7 at start-up adds paperless_docs, receipt_links, watch_offers and watch_pages; nothing existing changes. Back up /data before the first start (stop the container, copy finance-hub.db, -wal and -shm). Receipt text is read from paperless to find the total but is not stored.
Network: the app makes outbound requests only when you press a button (Sync receipts, Check page, Read feed). Web pages are fetched over https only, never to private addresses, and only if the site's robots.txt allows it. Paperless is called on the address you configure.
Resources: unchanged. Healthcheck: GET /healthz -> 200 {"status":"ok","version":"0.7.0"} (unchanged).
Verify after deploy:
 1. `docker ps` healthy; `wget -qO- http://127.0.0.1:8070/healthz` shows 0.7.0.
 2. With paperless set: Budget > Receipts > Sync now reports documents read; from the container, `wget -qO- $PAPERLESS_URL/api/` should answer (if not, fix the address or Docker network).
 3. Cards and bonuses > Watchlist: add an offer, press Check page on one with a web address.
PWA: manifest and install unchanged; cache name finance-hub-v0.7.0; shell cache lists watch.js and receipts.js. Layouts checked locally in Chromium at 390x844 and 1440x900: no horizontal scroll.
Rollback: previous image tag 0.6.0. The new tables stay and are ignored by 0.6.0.
Known issues: charges are matched by the amount the card posted, so a foreign-currency receipt will not match on its own (link it by hand); receipts without a readable total are listed but not matched; the uuid advisory in exceljs (moderate) is not reachable here and is left; paperless and live web pages were tested only against local mock servers; real Docker build was not run in the authoring environment, so confirm the container starts healthy after deploy.
Backup tier: small/critical (Tier 1).
