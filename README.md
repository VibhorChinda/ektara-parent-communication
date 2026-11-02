# Parent Communication System

School and college admins send announcements (PTM reminders, notices) to parents over WhatsApp
using Meta-approved templates via Twilio. Parents are organised by institution: **school → class →
section**, or **college → year (1–4)**. Parents who don't confirm within 6 hours get an automatic
IVR call ("Press 1 to confirm, press 2 to decline"). Parents who still don't respond are flagged
for personal follow-up.

- `backend/`: FastAPI API, Twilio webhooks and cron endpoint
- `web/`: Next.js admin app
- `supabase/migrations/`: database schema
- `render.yaml`: Render blueprint (backend, web app, optional paid cron job)
- `.github/workflows/cron-tick.yml`: free scheduler that calls the cron tick

There are no user roles. Every user who can log in has full access.

## How it works

1. **Parents**: upload a CSV on the Parents page. Phones are stored as `+91...`. Filter the directory
   by school/college, class/year and section, open a parent to edit, opt them out or delete them, and
   see their history. "Hard to reach" lists parents who answered none of their last 2+ messages.
   At year end, use **Move** (e.g. class 7 → 8, highest class first) and **Delete group**.
2. **Templates**: request a template. It goes straight to WhatsApp (Meta) via Twilio's Content API
   (`draft` → `pending_meta`). Every 15 minutes the cron job asks Twilio for Meta's decision and marks
   it `approved` or `rejected` (with the reason). Rejected templates can be edited and resubmitted
   as a new version (`_v2`, `_v3`).
3. **Campaigns**: pick a whole school/college, one class/year or one section, and an approved
   template; fill in the values and send. Each parent gets one WhatsApp message, in their language
   when an approved template with the same name exists in it (e.g. `ptm_reminder` in `en` and `hi`). Twilio reports `sent` → `delivered` → `read`. A **Confirm** / **Can't attend**
   button tap, or a reply "yes"/"no"/"1"/"2", sets `confirmed` / `declined`.
4. **IVR fallback** (cron, only between `CALL_WINDOW_START` and `CALL_WINDOW_END`):
   - no answer 6 hours after the WhatsApp message → call;
   - parents without WhatsApp, or whose WhatsApp message failed → call at the next tick.
   Each parent is called at most once per campaign. Press 1 → `confirmed`, 2 → `declined`. A wrong
   key replays the question once. No answer, busy, or hung up without pressing 1/2 → `flagged`.
5. **Follow-up**: open a campaign, filter on **Needs follow-up**, call the parent and click the row to
   record their answer (**Mark confirmed / declined**). The same panel shows any typed reply and the raw
   Twilio timeline. **Stop campaign** cancels unsent messages and further calls; **Retry failed** resends
   WhatsApp to parents whose message failed and who have not been called yet.
6. **Opt-out**: a parent who replies `STOP` (or `UNSUBSCRIBE`) gets no more messages or calls; `START`
   undoes it. Admins can also toggle it on the parent.

Message statuses only move forward (`queued < sent < delivered < read < confirmed/declined`), so
late or repeated Twilio callbacks can't undo a confirmation. A late "yes" still overrides `flagged`.

## Setup

### Before you start: Twilio prerequisites

1. Create a Twilio account and enable the **WhatsApp sandbox**. Join it from a test phone.
2. For production, complete Meta Business verification and register a WhatsApp sender in Twilio.
   This takes time, so start early.
3. Buy or verify a voice-capable Twilio number. Check Twilio's current rules for outbound calls
   to Indian numbers (caller ID and regulatory requirements). If Twilio voice to India doesn't work
   for you, only `backend/app/services/twilio_client.py` has to change (e.g. to Exotel).
4. Twilio's docs say content templates are sent through a **Messaging Service**. If sending from
   the plain WhatsApp number fails, create a Messaging Service with your WhatsApp sender in it and set
   `TWILIO_MESSAGING_SERVICE_SID` (the backend then uses it instead of `TWILIO_WHATSAPP_FROM`).

### 1. Supabase

1. Create a Supabase project.
2. Open **SQL Editor**, paste the contents of `supabase/migrations/0001_init.sql` and run it, then do
   the same with `0002_institutions_and_followups.sql`. (Already running 0001? Just run 0002: existing
   parents move to a school called "My school", and class "7-B" becomes class 7, section B. Rename it
   from the Parents page or by re-uploading your CSV.)
3. Create admin users in **Authentication → Users → Add user** (email + password).
   There is no sign-up page. Create users *after* running the migration: a trigger creates their
   `profiles` row, which campaigns and templates need.
4. For **Forgot password**: in **Authentication → URL Configuration**, set the Site URL to the web
   app's URL and add `<web-url>/reset-password` (and `http://localhost:3000/reset-password`) to the
   Redirect URLs. Supabase's built-in email sender only allows a few emails per hour; set up custom
   SMTP under **Authentication → Emails** for real use.
5. From **Project Settings → API**, copy:
   - Project URL → `SUPABASE_URL` (backend) and `NEXT_PUBLIC_SUPABASE_URL` (web)
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (backend only, never in the web app)
   - `anon` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web)
   - `SUPABASE_JWT_SECRET` is not needed: the backend checks tokens with Supabase Auth directly.

### 2. Backend (local)

Requires Python 3.11+.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # then fill in the values
uvicorn app.main:app --reload --port 8000
```

Check it with `curl http://localhost:8000/health`. Expected result: `{"status":"ok"}`.
The backend refuses to start if a required variable in `.env` is missing.

Twilio must reach the webhooks, so for anything beyond the API itself, deploy the backend
(below) or expose your local server with a tunnel of your choice and set `PUBLIC_BASE_URL` to it.

### 3. Web app (local)

Requires Node 20+.

```bash
cd web
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

Open http://localhost:3000 and log in with a user from step 1.

## Deploy to Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick the repo. Render reads `render.yaml` and creates:
   - `parent-comm-api`: the backend,
   - `parent-comm-web`: the admin app.

   Both use the **free** plan for testing. Free services sleep after 15 idle minutes and take
   about a minute to wake. The cron tick limits the damage: it resumes campaigns whose sending was
   interrupted, re-checks messages stuck on "sent" and recovers WhatsApp replies whose webhook was
   lost. For real campaigns, still set the API to `plan: starter`.
3. **Scheduler** (needed for fallback calls, template approvals and the recovery jobs). Pick one:
   - **Free:** GitHub Actions. In the GitHub repo, **Settings → Secrets and variables → Actions**, add
     `PUBLIC_BASE_URL` and `CRON_SECRET`. `.github/workflows/cron-tick.yml` then calls the tick every
     10 minutes during the day (which also keeps a free API awake) and hourly at night. GitHub can delay
     runs a little and pauses schedules after 60 days without commits; re-enable them in the Actions tab.
   - **Paid:** uncomment `parent-comm-cron` in `render.yaml` (Render cron jobs are paid).
4. Render asks for every value marked `sync: false`. The service URLs are only known after the first
   deploy, so fill in what you have, then come back:
   - `parent-comm-api`: Twilio and Supabase values, `CRON_SECRET` (a long random string, e.g.
     `openssl rand -hex 32`), `PUBLIC_BASE_URL` = the API's URL (e.g. `https://parent-comm-api.onrender.com`,
     no trailing slash), `WEB_ORIGIN` = the web app's URL.
   - `parent-comm-web`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `NEXT_PUBLIC_API_BASE_URL` = the API's URL.
   - `parent-comm-cron` (only once enabled): the **same** `CRON_SECRET` and `PUBLIC_BASE_URL` as the API.
5. After setting the URLs, redeploy both web services. The web app must be rebuilt because
   `NEXT_PUBLIC_*` values are baked in at build time.
6. Check `https://<api-url>/health` returns `{"status":"ok"}`.
7. In the Twilio Console, set the WhatsApp sandbox (or your sender's) **"When a message comes in"**
   URL to `https://<api-url>/webhooks/whatsapp/inbound` (method POST). The status, voice and gather
   URLs are set by the backend on each message and call; nothing else to configure.
8. Run the tick once: **Actions → Cron tick → Run workflow** on GitHub, or
   `curl -X POST https://<api-url>/internal/cron/tick -H "X-Cron-Secret: <CRON_SECRET>"`. It should
   return a JSON result with one entry per job.

### Environment variables (backend)

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio credentials |
| `TWILIO_WHATSAPP_FROM` | WhatsApp sender, e.g. `whatsapp:+14155238886` (sandbox) |
| `TWILIO_VOICE_FROM` | Voice-capable Twilio number for IVR calls, e.g. `+1...` |
| `TWILIO_MESSAGING_SERVICE_SID` | Optional. If set, WhatsApp is sent through this Messaging Service |
| `PUBLIC_BASE_URL` | Public backend URL, no trailing slash. Must match exactly what Twilio calls, or every webhook returns 403 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase access (service role: backend only) |
| `SUPABASE_JWT_SECRET` | Not used; may be empty |
| `CRON_SECRET` | Shared secret the cron job sends in `X-Cron-Secret` |
| `WEB_ORIGIN` | URL of the web app, for CORS |
| `CALL_FALLBACK_HOURS` | Hours to wait before the IVR call (default 6) |
| `CALL_WINDOW_START`, `CALL_WINDOW_END` | Calls are only placed between these times (default 09:00–19:00) |
| `APP_TIMEZONE` | Timezone for the call window (default `Asia/Kolkata`) |
| `SEND_CONCURRENCY` | Parallel WhatsApp sends (default 10) |
| `COST_PER_WHATSAPP`, `COST_PER_CALL`, `COST_CURRENCY` | Optional rough prices for the estimate shown before sending (0 hides it). Look up current Twilio and Meta pricing for your country |

### Environment variables (web)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Login (public values, safe in the browser) |
| `NEXT_PUBLIC_API_BASE_URL` | Backend URL, e.g. `http://localhost:8000` |

## Manual test checklist

Run these yourself after deploying. Testing on the sandbox, use your own joined phone number as
the parent.

1. **Login**: log in on the web app. Logging out and opening `/campaigns` sends you back to `/login`.
2. **Upload parents**: upload a CSV with your test phone (institution `Test School`, class `TEST`,
   `has_whatsapp` yes) and one bad row. Expect "1 added, 1 rejected" and a reason for the bad row.
   Add a college row too and check the directory filter shows school → class → section and
   college → year.
3. **Request a template**: on Templates, request `ptm_reminder` (example below) with buttons. It shows
   **Pending Meta**. Try a body ending in `{{3}}` and check the inline error.
4. **Approval**: wait, or run the cron job by hand (see below). It becomes **Approved** (or **Rejected**
   with a reason; then try "Edit and resubmit").
5. **Send**: New campaign → `Test School` → class `TEST` → the template → fill values → Send → confirm the popup.
   The page opens the campaign; your phone gets the message; statuses move to Sent/Delivered/Read.
6. **Confirm**: tap **Confirm** on the phone. Within 10 s the parent shows **Confirmed**.
7. **Fallback**: send again to a class with a second test phone and don't answer. For a quick test set
   `CALL_FALLBACK_HOURS=0` on the API (and make sure the current time is inside the call window),
   then trigger the cron job. The phone rings; press **1** → **Confirmed** (answered on the phone call).
8. **Flagged**: repeat step 7 but don't pick up. After the call ends the parent shows **Needs
   follow-up**. Click the row, **Mark confirmed**, and check the status changes.
9. **Reply text**: reply "Can I come at 11?" on WhatsApp. The campaign row shows the text.
10. **Opt-out**: reply `STOP`. The parent shows **Opted out** on the Parents page and is skipped by the
    next campaign. Reply `START` to undo.
11. **Stop / retry**: start a campaign and click **Stop campaign**; unsent messages become Cancelled.
    For a failed message (e.g. a number not in the sandbox), fix it and click **Retry failed**.
12. **Template notice**: after Meta decides, a green (or red) banner appears for the admin who
    requested the template. **Check status now** on Templates asks Meta right away.
13. **Forgot password**: log out, click **Forgot password?**, follow the email link, set a new password.
14. **Debugging**: every webhook payload is stored in the `message_events` table, and shown in the
    campaign's row panel under **Timeline**. Check it first when something looks wrong.

Example template body:

```
Dear parent, the PTM is on {{1}} at {{2}} in {{3}}. Please confirm your attendance.
```

Run the cron job by hand:

```bash
curl -X POST https://<api-url>/internal/cron/tick -H "X-Cron-Secret: $CRON_SECRET"
```

**Sandbox note:** Meta only approves templates for a registered WhatsApp sender. With the sandbox
alone, submitting a template may fail or never be approved. To test sending anyway, set that
template's `status` to `approved` in the Supabase Table Editor and send within 24 hours of your test
phone last messaging the sandbox (WhatsApp's free-reply window).

## API reference

All `/api/*` routes need `Authorization: Bearer <Supabase access token>`.

| Route | What it does |
|---|---|
| `POST /api/parents/upload` | Multipart `file` (UTF-8 CSV). Returns inserted/updated/rejected counts and errors |
| `GET /api/parents?institution=&class_or_year=&section=` | List parents with response stats |
| `GET /api/parents/groups` | Every institution / class-or-year / section with reachable parent counts and languages |
| `PATCH /api/parents/{id}`, `DELETE /api/parents/{id}` | Edit (incl. `opted_out`) or delete one parent |
| `GET /api/parents/{id}/history` | The parent's latest messages |
| `POST /api/parents/move` | `{source: {institution, class_or_year, section}, class_or_year, section}`: year-end promotion |
| `POST /api/parents/delete-group` | `{institution, class_or_year, section}`: delete a group |
| `GET /api/templates?status=` | List templates |
| `POST /api/templates/sync` | Ask Meta for decisions on pending templates now |
| `GET /api/templates/notifications`, `POST /api/templates/{id}/seen` | Unseen decisions on your templates |
| `POST /api/templates` | Create a template and submit it to WhatsApp |
| `POST /api/templates/{id}/submit` | Retry a `draft` template whose submission failed |
| `POST /api/templates/{id}/resubmit` | New version of an approved/rejected template, submitted right away |
| `POST /api/campaigns` | `{template_id, institution, class_or_year?, section?, variables}`. Sends in the background, returns the id |
| `GET /api/campaigns?offset=&institution=&class_or_year=&section=` | 50 campaigns at a time, newest first, with counts and sender |
| `GET /api/campaigns/{id}?status=` | One campaign with counts and messages (incl. estimated call time) |
| `POST /api/campaigns/{id}/cancel` | Stop: cancel unsent messages and further calls |
| `POST /api/campaigns/{id}/retry-failed` | Resend WhatsApp to failed messages not yet called |
| `POST /api/messages/{id}/resolve` | `{outcome: "confirmed" or "declined"}` after a personal call |
| `GET /api/messages/{id}/events` | Raw webhook/cron/admin events for one message |
| `GET /api/info` | Fallback timing and price settings for the web app |
| `POST /webhooks/...` | Twilio only (signature checked): WhatsApp status/inbound, voice twiml/gather/status |
| `POST /internal/cron/tick` | Header `X-Cron-Secret`. Resumes interrupted campaigns, re-checks messages stuck on "sent", recovers missed WhatsApp replies, IVR fallback, template status sync |

To call the API with curl, get a token by logging in:

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@school.org","password":"..."}'
```

### Parents CSV

```csv
parent_name,phone,child_name,institution,institution_type,class_or_year,section,language,has_whatsapp
Asha Rao,98765 43210,Riya Rao,Sunrise Public School,school,7,B,hi,yes
Vikram Shah,+919812345678,Aarav Shah,Sunrise Public School,school,7,B,en,no
Meera Iyer,98400 12345,Karthik Iyer,City Engineering College,college,2,,ta,yes
```

The **Sample CSV** button on the Parents page downloads this file.

- Required columns: `parent_name`, `phone`, `institution`, `class_or_year`. The others may be missing.
- `institution`: the school or college name. Extra spaces are removed; use the same spelling every time.
- `institution_type`: `school` (default) or `college`. One name can't be both in the same file.
- `class_or_year`: schools use any class name (`7`, `LKG`; "Class 7" becomes `7`). Colleges use the
  year `1`–`4` ("2nd year" becomes `2`).
- `section`: schools only, e.g. `B` (stored uppercase). Leave empty for a class with one section, and
  always for colleges.
- `phone`: Indian numbers can omit `+91`. Stored as E.164 (`+919876543210`).
- `language`: `en`, `hi`, `ta`, ... Empty means `en`. Picks the template version and the IVR voice.
- `has_whatsapp`: `yes/no/true/false/1/0`. Empty means yes. Parents without WhatsApp are only called.
- Rows are matched on phone: a known phone updates that parent. Repeated phones within one file
  are rejected. Valid rows are saved even if others are rejected.
- In Excel, format the phone column as Text, or long numbers turn into `9.88E+09`.
- **Opt-out** is never reset by a re-upload. Change it on the parent, or the parent replies STOP/START.

### Template rules

Checked before submitting (from Meta's rules): lowercase name with letters, digits and underscores;
placeholders `{{1}}..{{n}}` with no gaps; the body must not start or end with a placeholder, and two
placeholders must not be next to each other; a label and a sample value for each placeholder; body
up to 1024 characters; UTILITY templates must not use promotional words (offer, discount, sale).

Meta has one more rule this app does not check: roughly 2 words of plain text per placeholder, plus
one. Very short bodies with many placeholders may be rejected.

## IVR voices and languages

Scripts live in `backend/app/voice_scripts.py`: English (`en`, voice `Google.en-IN-Standard-A`),
Hindi (`hi`, `Google.hi-IN-Standard-A`) and Tamil (`ta`, `Google.ta-IN-Standard-C`). The call reads
the campaign values in order (e.g. "12 Nov, 10 AM, Hall A").

- Have a native speaker check the Hindi and Tamil wording before going live.
- Parents with any other language get the English script. To add a language, add an entry to
  `SCRIPTS` with a voice from Twilio's text-to-speech list
  (https://www.twilio.com/docs/voice/twiml/say/text-speech). If Twilio has no voice for a language,
  you would need pre-recorded audio played with `<Play>`; that is not built.
- The Hindi and Tamil voice names come from Twilio's docs but could not be fully confirmed. If a call
  says nothing or errors, check the Twilio call log and change the `voice` value.

## Tests

Unit tests cover the status rules, template and CSV validation, reply/opt-out parsing, the call-time
estimate and webhook signature checking. They use fake settings and never call Twilio or Supabase.

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

## Known limitations

- If the backend stops mid-send, the next cron tick (10+ minutes later) resumes the campaign. Each
  message is claimed before sending, so it is not sent twice; the one exception is a crash in the
  instant after Twilio accepted a message but before it was saved, which can resend that one message.
- The IVR fallback only acts on messages from the last 48 hours, so a long cron outage does not
  cause calls about old announcements.
- Recovered WhatsApp replies (webhook lost) only cover the last 3 hours and carry the button's text,
  not its id; "Confirm" and "Can't attend" are still recognised.
- A phone number belongs to one parent row, so a parent with children in two classes appears once.
- The estimated call time on the campaign page assumes the scheduler is running.
- WhatsApp button and reply field names (`ButtonPayload`, `Body`, `OriginalRepliedMessageSid`)
  follow Twilio's docs. Check the first real payloads in `message_events` and adjust
  `backend/app/services/replies.py` if they differ.
