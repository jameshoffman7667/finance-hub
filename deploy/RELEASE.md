# Release v0.4.0
Image: mybadreligon/finance-hub:0.4.0   (built when this version is pushed to main; the workflow also creates the v0.4.0 tag and release)
Short: Add offer planner and bonus ledger
Long: Save offer terms, compare staying with moving by return per year, and turn the choice into dated plan steps with reminders. Track each bonus with costs and time to see if it paid off. Covers P-10 and P-11.
Type: minor (new features, new tables). Pending entries built: P-10, P-11.
Host port: 8070 (PORT_HOST=8070)   Container port: 8070 (same; the app reads PORT)
Public hostname: unchanged   Needs Caddy route: no (unchanged)
New env vars: none. Cloudflare: unchanged (the /cal/* bypass from 0.3.0 still applies; plan steps with Remind on also appear in that feed).
Data: schema 3 -> 4 at start-up adds seven tables (offer_terms, holdings, debts, ledger_entries, plans, plan_steps, effort_logs); nothing existing changes. Back up /data before the first start anyway (stop the container, copy finance-hub.db, -wal and -shm). Settings (benchmark, worth-it line, point values, expected hours) are stored in the existing settings table under the key planner.
Resources: unchanged. Healthcheck: GET /healthz -> 200 {"status":"ok","version":"0.4.0"} (unchanged).
Verify after deploy:
 1. `docker ps` healthy; `wget -qO- http://127.0.0.1:8070/healthz` shows 0.4.0.
 2. Cards and bonuses > Offers: add a test offer (e.g. rate 3% registered, hold dates, payouts 2028-04-28 40% and 2029-03-30 60%), press Make a plan, then open Plans and Calendar: the steps show with their dates.
 3. Holdings and debts: add a holding that counts toward an offer; Compare: pick it and another offer; the result shows return per year, what leaving gives up, net versus staying and any assumptions.
 4. Bonus ledger: Track the bonus on an offer, mark it Paid with an amount, log some time; the totals and the Overview tile update.
 5. Planner settings: change the benchmark, press Save, reload: it is kept.
PWA: manifest and install unchanged; cache name finance-hub-v0.4.0. Layouts checked locally in Chromium at 390x844 and 1440x900: no horizontal scroll on the new tabs; the compare view is stacked cards on phone and one table on desktop.
Rollback: previous image tag 0.3.0. The new tables stay and are ignored by 0.3.0.
Known issues: no web fetching of offer pages yet (terms are typed in; P-9 later); the point values are seeded from public sources dated 2026-11-04 and must be refreshed by hand each quarter; taxes are information only; real Docker build was not run in the authoring environment, so confirm the container starts healthy after deploy.
Backup tier: small/critical (Tier 1).
