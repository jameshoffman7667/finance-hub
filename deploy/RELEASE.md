# Release v0.6.0
Image: mybadreligon/finance-hub:0.6.0   (built when this version is pushed to main; the workflow also creates the v0.6.0 tag and release)
Short: Add wealth overview and projection
Long: Balance sheet, cash flow from your categories, and a month-by-month projection of wealth with growth, a HELOC rate test and spends you are considering. Planned yearly and large spends. Covers P-15.
Type: minor (new feature, new table). Pending entries built: P-15.
Host port: 8070 (PORT_HOST=8070)   Container port: 8070 (same; the app reads PORT)
Public hostname: unchanged   Needs Caddy route: no (unchanged)
New env vars: none. Cloudflare: unchanged.
Data: schema 5 -> 6 at start-up adds the plan_items table and a flow_group column on categories; nothing existing changes. Back up /data before the first start (stop the container, copy finance-hub.db, -wal and -shm). Wealth settings are stored in the settings table under the key wealth.
Resources: unchanged. Healthcheck: GET /healthz -> 200 {"status":"ok","version":"0.6.0"} (unchanged).
Verify after deploy:
 1. `docker ps` healthy; `wget -qO- http://127.0.0.1:8070/healthz` shows 0.6.0.
 2. Wealth > Balance sheet shows your account values and net worth; Cash flow shows this month by group.
 3. Wealth > Planned and potential spends: add a yearly cost and one you are considering; Projection shows both lines.
PWA: manifest and install unchanged; cache name finance-hub-v0.6.0; shell cache lists wealth.js. Layouts checked locally in Chromium at 390x844 and 1440x900: no horizontal scroll.
Rollback: previous image tag 0.5.0. The new table and column stay and are ignored by 0.5.0.
Known issues: investment growth is estimated from account values and recorded transactions, so it is only as good as those records; the planned yearly items from your notes are not seeded (enter them in the app); a loan entered both as an account and in the planner is counted twice; real Docker build was not run in the authoring environment, so confirm the container starts healthy after deploy.
Backup tier: small/critical (Tier 1).
