# Release v0.3.0
Image: mybadreligon/finance-hub:0.3.0   (built when this version is pushed to main; the workflow also creates the v0.3.0 tag and release)
Short: Add statements, reminders and calendar
Long: Read card statement CSVs for spend progress, bonus awards and repeating charges. Reminders in the inbox, by e-mail and web push. Calendar with a private feed for Google Calendar. Covers P-6, P-7 and P-8.
Type: minor (new features, new tables). Pending entries built: P-6, P-7, P-8.
Host port: 8070 (PORT_HOST=8070)   Container port: 8070 (same; the app reads PORT)
Public hostname: unchanged   Needs Caddy route: no (unchanged)
New optional env vars (add to the server .env; all in .env.example): SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM. Use the existing SMTP2GO values (mail.smtp2go.com, 587, SMTP_SECURE=false, sender server@hoffmanhouse.ca). Compose must pass them through (compose.yaml lists them). Without SMTP_HOST and SMTP_FROM the app still runs; e-mail reminders are held back.
Cloudflare: the calendar feed is read by Google without signing in. Add an Access policy with action Bypass (or Service Auth not required) for the path /cal/* on this hostname only. Everything else stays behind Access. The address is a 48-character random code and carries event names only.
Data: schema 2 -> 3 at start-up adds four tables; nothing existing changes, so no pre-migration copy. Back up /data before the first start anyway (stop the container, copy finance-hub.db, -wal and -shm).
Resources: idle RAM 90-140 MB; a background check runs hourly (milliseconds). No limits needed.
Healthcheck: GET /healthz -> 200 {"status":"ok","version":"0.3.0"} (unchanged).
Verify after deploy:
 1. `docker ps` healthy; `wget -qO- http://127.0.0.1:8070/healthz` shows 0.3.0.
 2. Cards and bonuses > Calendar: the month shows your card payment and bonus dates; copy the feed address; open it in a private browser window: it must show calendar text (after the Cloudflare bypass is in place), and a wrong code must show Not found.
 3. In Google Calendar add the address (Other calendars > From URL); events appear within a few hours.
 4. Reminders: Save an e-mail address, press "Send a test e-mail" and confirm it arrives; press Check now.
 5. Reminders > Turn on push on this device (iPhone: add to Home Screen first); then Check now with a lead time long enough to create an entry and confirm the notification.
 6. Statements: pick a card, upload a real statement CSV, check the numbers, Save, and confirm the card's spend progress changed.
PWA: manifest and install unchanged; the worker now also handles push (cache name finance-hub-v0.3.0). Layouts checked locally in Chromium at 390x844 and 1440x900: no horizontal scroll on the new tabs. Lighthouse not run.
Rollback: previous image tag 0.2.0. The new tables stay and are ignored by 0.2.0.
Known issues: statement parsing is generic CSV only (no PDF, no per-issuer rules), so odd exports may need the sign or date setting changed; the spend figure is an estimate; Google refreshes feeds slowly; web push and e-mail delivery were tested only up to the server (no real push service or SMTP server was available in the authoring environment); npm audit still lists 2 moderate findings in uuid inside exceljs (not reachable). Docker build not run (no Docker daemon in the authoring environment); the release workflow is the first build.
Backup tier: small/critical (Tier 1).
