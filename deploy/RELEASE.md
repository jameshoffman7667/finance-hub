# Release v0.8.0
Image: mybadreligon/finance-hub:0.8.0   (built when this version is pushed to main; the workflow also creates the v0.8.0 tag and release)
Short: Edit accounts, sub-categories, import balances
Long: Edit, delete and group accounts with pick lists; comment and reference on imports; balance from imports; optional sub-categories, cash and loan categories, Settings Lists. P-17 to P-27.
Type: minor (new features, schema change). Pending entries built: P-17 to P-27.
Host port: 8070 (PORT_HOST=8070)   Container port: 8070 (same; the app reads PORT)
Public hostname: unchanged   Needs Caddy route: no (unchanged)
New env vars: none.
Data: schema 7 -> 8 at start-up (additive): adds the subcategories table, comment/reference/sub-category columns on transactions, field and sub-category on rules, an import mapping on accounts, and nets-into on categories; adds new shipped categories (Credit card payment, Loan payment, Cash withdrawal, Cash deposit, Cash returned to account, Children and Pets) unless a category with that name exists. Existing data is unchanged; existing transaction text becomes the Description. Back up /data before the first start (stop the container, copy finance-hub.db, -wal and -shm). New: deleting an account can remove its transactions, balances and imports after a confirmation that shows the counts.
Network: the app makes outbound requests only when you press a button (Sync receipts, Check page, Read feed). Web pages are fetched over https only, never to private addresses, and only if the site's robots.txt allows it. Paperless is called on the address you configure.
Resources: unchanged. Healthcheck: GET /healthz -> 200 {"status":"ok","version":"0.8.0"} (unchanged).
Verify after deploy:
 1. `docker ps` healthy; `wget -qO- http://127.0.0.1:8070/healthz` shows 0.8.0.
 2. With paperless set: Budget > Receipts > Sync now reports documents read; from the container, `wget -qO- $PAPERLESS_URL/api/` should answer (if not, fix the address or Docker network).
 3. Cards and bonuses > Watchlist: add an offer, press Check page on one with a web address.
PWA: manifest and install unchanged; cache name finance-hub-v0.8.0; shell cache lists watch.js and receipts.js. Layouts checked locally in Chromium at 390x844 and 1440x900: no horizontal scroll.
Rollback: previous image tag 0.6.0. The new tables stay and are ignored by 0.6.0.
Known issues: charges are matched by the amount the card posted, so a foreign-currency receipt will not match on its own (link it by hand); receipts without a readable total are listed but not matched; the uuid advisory in exceljs (moderate) is not reachable here and is left; paperless and live web pages were tested only against local mock servers; real Docker build was not run in the authoring environment, so confirm the container starts healthy after deploy.
Backup tier: small/critical (Tier 1).
