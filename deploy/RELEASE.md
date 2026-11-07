# Release v0.5.0
Image: mybadreligon/finance-hub:0.5.0   (built when this version is pushed to main; the workflow also creates the v0.5.0 tag and release)
Short: Add Smith Manoeuvre and tax support
Long: Track Smith Manoeuvre loans, interest and monthly capitalize reminders. New tax area: capital gains with cost base, medical, slips, room, carry-forwards and a review of opportunities. Covers P-12, P-13 and P-14.
Type: minor (new features, new tables). Pending entries built: P-12, P-13, P-14.
Host port: 8070 (PORT_HOST=8070)   Container port: 8070 (same; the app reads PORT)
Public hostname: unchanged   Needs Caddy route: no (unchanged)
New env vars: none. Cloudflare: unchanged (/cal/* bypass from 0.3.0 still applies).
Data: schema 4 -> 5 at start-up adds nine tables and a few columns on debts, holdings and ledger_entries; nothing existing changes. Back up /data before the first start (stop the container, copy finance-hub.db, -wal and -shm).
Resources: unchanged. Healthcheck: GET /healthz -> 200 {"status":"ok","version":"0.5.0"} (unchanged).
Verify after deploy:
 1. `docker ps` healthy; `wget -qO- http://127.0.0.1:8070/healthz` shows 0.5.0.
 2. Investments: add a loan tagged Smith Manoeuvre with an interest day; a monthly reminder appears, Confirm with an amount clears it; the Overview shows a notice while one is overdue.
 3. Tax > Years: add the current year with income and marginal rate; Investments > Interest by year shows an estimated tax value.
 4. Tax > Capital gains: add a buy and a sale; the table and Schedule 3 style rows update; Tax > Review lists findings; Download CSV opens.
PWA: manifest and install unchanged; cache name finance-hub-v0.5.0; the shell cache now also lists planner.js, smith.js and tax.js (planner.js was missing in 0.4.0, so Cards could fail offline). Layouts checked locally in Chromium at 390x844 and 1440x900: no horizontal scroll.
Rollback: previous image tag 0.4.0. The new tables and columns stay and are ignored by 0.4.0.
Known issues: tax figures are information only and rely on rates and thresholds you enter; no paperless-ngx receipt links yet (P-1); foreign amounts need the exchange rate typed on each trade; real Docker build was not run in the authoring environment, so confirm the container starts healthy after deploy.
Backup tier: small/critical (Tier 1).
