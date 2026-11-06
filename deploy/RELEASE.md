# Release v0.2.0
Image: mybadreligon/finance-hub:0.2.0   (built by the release workflow on the push of this version to main; the workflow also creates the v0.2.0 tag)
Short: Track card, bank and investment bonuses
Long: Cards (open, frozen, closed), bank and investment accounts with bonuses, re-apply rules with eligible-again dates, recurring payments, and workbook import. Red-text cells stay marked to check. Covers P-2 to P-5.
Type: minor (new features, new tables). Pending entries built: P-2, P-3, P-4, P-5.
Host port: 8070 (PORT_HOST=8070)   Container port: 8070 (same as the host port; the app reads PORT)
Public hostname: unchanged (Cloudflare Tunnel, protected by Cloudflare Access)   Needs Caddy route: no (unchanged)
New or changed env vars: none.
Data: schema 1 -> 2 runs at start-up. It only adds six tables (cards, card_bonuses, inst_accounts, acct_bonuses, recurring, issuer_rules); existing data is untouched, so no pre-migration copy is written. Back up /data anyway before the first start of 0.2.0 (stop the container, copy finance-hub.db, -wal and -shm). /data (fast storage) and /files (slow pool, reserved) are unchanged; owner uid 1000, gid 100.
Personal data: the workbook is uploaded through the app and stored only in the SQLite database under /data. Nothing personal is in the image or the repo. Only the last 4 digits of cards and accounts are stored.
Resources: expected idle RAM 80-130 MB (a workbook import peaks around 150-200 MB for a moment while the file is parsed); CPU near zero. No limits needed (optional mem_limit 384m). Image is larger by about 20 MB (exceljs).
Healthcheck: GET /healthz on $PORT -> 200 {"status":"ok","version":"0.2.0"} (unchanged behaviour).
Verify after deploy:
 1. `docker ps` shows finance-hub healthy and `wget -qO- http://127.0.0.1:8070/healthz` on the server returns {"status":"ok","version":"0.2.0"}.
 2. Sign in, open Cards and bonuses: six tabs load with no error. The existing accounts, balances and transactions are still there.
 3. Add a test card with a bonus, check the qualify-by date and the re-application result, then delete it.
 4. Import tab: choose the history workbook, check the preview counts, import with "add new only", then open a card shown with a red To check label, edit one red field and confirm the label clears.
 5. Settings > Export (re-enter the password) includes cards and issuer_rules in the JSON.
 6. Reload once after the update banner appears so the new service worker (finance-hub-v0.2.0) takes over; the app still installs and works offline for the shell.
PWA: unchanged install requirements; new file offers.js is in the cached shell. Layouts checked locally in Chromium at 390x844 and 1440x900: no horizontal scroll on any of the six tabs or in the edit dialog. Lighthouse PWA result: not run.
Rollback: previous image tag 0.1.3. The 0.2.0 tables stay in the database and 0.1.3 ignores them, so rolling back needs no data restore (restore the pre-update copy only if you want the new records gone).
Known issues: no notifications, statement analysis or calendar yet (P-6 to P-8); eligibility uses the rules you enter and the red-text rules from the workbook are community-reported until you check them against the issuer's terms; npm audit lists 2 moderate findings in the uuid package inside exceljs (affects uuid v3/v5/v6 with a caller-supplied buffer, which exceljs does not use); the screens were checked in Chromium only. Docker build: not run locally (Docker Hub unreachable in the authoring environment); the release workflow is the first build, so confirm the container is healthy after deploy.
Backup tier: small/critical (include in Tier 1). SQLite needs the container stopped during a file copy (or copy .db, -wal and -shm together).
