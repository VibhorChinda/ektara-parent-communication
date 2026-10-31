# Parent Communication System

School admins send announcements (PTM reminders, notices) to parents over WhatsApp using
Meta-approved templates via Twilio. Parents who don't confirm within 6 hours get an automatic
IVR call ("Press 1 to confirm, press 2 to decline"). Parents who still don't respond are flagged
for personal follow-up.

- `backend/`: FastAPI API, Twilio webhooks and cron endpoint
- `web/`: Next.js admin app
- `supabase/migrations/`: database schema
- `render.yaml`: Render blueprint (backend, web app, 15-minute cron job)

There are no user roles. Every user who can log in has full access.

## How it works

1. **Parents**: upload a CSV on the Parents page. Phones are stored as `+91...`.
2. **Templates**: request a template. It goes straight to WhatsApp (Meta) via Twilio's Content API
   (`draft` → `pending_meta`). Every 15 minutes the cron job asks Twilio for Meta's decision and marks
   it `approved` or `rejected` (with the reason). Rejected templates can be edited and resubmitted
   as a new version (`_v2`, `_v3`).
3. **Campaigns**: pick a class and an approved template, fill in the values, send. Each parent gets
   one WhatsApp message. Twilio reports `sent` → `delivered` → `read`. A **Confirm** / **Can't attend**
   button tap, or a reply "yes"/"no"/"1"/"2", sets `confirmed` / `declined`.
4. **IVR fallback** (cron, only between `CALL_WINDOW_START` and `CALL_WINDOW_END`):
   - no answer 6 hours after the WhatsApp message → call;
   - parents without WhatsApp, or whose WhatsApp message failed → call at the next tick.
   Each parent is called at most once per campaign. Press 1 → `confirmed`, 2 → `declined`. A wrong
   key replays the question once. No answer, busy, or hung up without pressing 1/2 → `flagged`.
5. **Follow-up**: open a campaign and tick "Flagged only".

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
2. Open **SQL Editor**, paste the contents of `supabase/migrations/0001_init.sql` and run it.
3. Create admin users in **Authentication → Users → Add user** (email + password).
   There is no sign-up page. Create users *after* running the migration: a trigger creates their
   `profiles` row, which campaigns and templates need.
4. From **Project Settings → API**, copy:
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
   about a minute to wake, so Twilio callbacks that arrive while asleep can be lost, and a sleeping
   instance can drop sends that are in progress. Open `https://<api-url>/health` to wake it before
   each test. The cron job is commented out because Render cron jobs are paid; trigger the tick by hand:
   `curl -X POST https://<api-url>/internal/cron/tick -H "X-Cron-Secret: <CRON_SECRET>"`.
   For real use, set the API to `plan: starter` and uncomment `parent-comm-cron` (about $8/month total).
3. Render asks for every value marked `sync: false`. The service URLs are only known after the first
   deploy, so fill in what you have, then come back:
   - `parent-comm-api`: Twilio and Supabase values, `CRON_SECRET` (a long random string, e.g.
     `openssl rand -hex 32`), `PUBLIC_BASE_URL` = the API's URL (e.g. `https://parent-comm-api.onrender.com`,
     no trailing slash), `WEB_ORIGIN` = the web app's URL.
   - `parent-comm-web`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `NEXT_PUBLIC_API_BASE_URL` = the API's URL.
   - `parent-comm-cron` (only once enabled): the **same** `CRON_SECRET` and `PUBLIC_BASE_URL` as the API.
4. After setting the URLs, redeploy both web services. The web app must be rebuilt because
   `NEXT_PUBLIC_*` values are baked in at build time.
5. Check `https://<api-url>/health` returns `{"status":"ok"}`.
6. In the Twilio Console, set the WhatsApp sandbox (or your sender's) **"When a message comes in"**
   URL to `https://<api-url>/webhooks/whatsapp/inbound` (method POST). The status, voice and gather
   URLs are set by the backend on each message and call; nothing else to configure.
7. Run the `curl` tick command above once (or, with the cron job enabled, use **Trigger Run** in Render); it should return a JSON result.

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

### Environment variables (web)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Login (public values, safe in the browser) |
| `NEXT_PUBLIC_API_BASE_URL` | Backend URL, e.g. `http://localhost:8000` |

## Manual test checklist

Run these yourself after deploying. Testing on the sandbox, use your own joined phone number as
the parent.

1. **Login**: log in on the web app. Logging out and opening `/campaigns` sends you back to `/login`.
2. **Upload parents**: upload a CSV with your test phone (class `TEST`, `has_whatsapp` yes) and one
   bad row. Expect "1 added, 1 rejected" and a reason for the bad row.
3. **Request a template**: on Templates, request `ptm_reminder` (example below) with buttons. It shows
   **Pending Meta**. Try a body ending in `{{3}}` and check the inline error.
4. **Approval**: wait, or run the cron job by hand (see below). It becomes **Approved** (or **Rejected**
   with a reason; then try "Edit and resubmit").
5. **Send**: New campaign → class `TEST` → the template → fill values → Send → confirm the popup.
   The page opens the campaign; your phone gets the message; statuses move to Sent/Delivered/Read.
6. **Confirm**: tap **Confirm** on the phone. Within 10 s the parent shows **Confirmed**.
7. **Fallback**: send again to a class with a second test phone and don't answer. For a quick test set
   `CALL_FALLBACK_HOURS=0` on the API (and make sure the current time is inside the call window),
   then trigger the cron job. The phone rings; press **1** → **Confirmed** (answered on the phone call).
8. **Flagged**: repeat step 7 but don't pick up. After the call ends the parent shows **Flagged** and
   appears under "Flagged only".
9. **Debugging**: every webhook payload is stored in the `message_events` table (Supabase Table
   Editor). Check it first when something looks wrong.

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
| `GET /api/parents?class_name=` | List parents |
| `GET /api/parents/classes` | Class names with the number of reachable (not opted-out) parents |
| `GET /api/templates?status=` | List templates |
| `POST /api/templates` | Create a template and submit it to WhatsApp |
| `POST /api/templates/{id}/submit` | Retry a `draft` template whose submission failed |
| `POST /api/templates/{id}/resubmit` | New version of an approved/rejected template, submitted right away |
| `POST /api/campaigns` | `{template_id, class_name, variables}`. Sends in the background, returns the id |
| `GET /api/campaigns` | Latest 100 campaigns with counts per status |
| `GET /api/campaigns/{id}?status=` | One campaign with counts and messages (e.g. `?status=flagged`) |
| `POST /webhooks/...` | Twilio only (signature checked): WhatsApp status/inbound, voice twiml/gather/status |
| `POST /internal/cron/tick` | Header `X-Cron-Secret`. Re-checks messages stuck on "sent" with Twilio (lost callbacks), IVR fallback, template status sync |

To call the API with curl, get a token by logging in:

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@school.org","password":"..."}'
```

### Parents CSV

```csv
parent_name,phone,child_name,class_name,language,has_whatsapp
Asha Rao,98765 43210,Riya Rao,7-B,hi,yes
Vikram Shah,+919812345678,Aarav Shah,7-B,en,no
```

- `phone`: Indian numbers can omit `+91`. Stored as E.164 (`+919876543210`).
- `language`: `en`, `hi`, `ta`, ... Empty means `en`. Used for the IVR call voice.
- `has_whatsapp`: `yes/no/true/false/1/0`. Empty means yes. Parents without WhatsApp are only called.
- Rows are matched on phone: a known phone updates that parent. Repeated phones within one file
  are rejected. Valid rows are saved even if others are rejected.
- In Excel, format the phone column as Text, or long numbers turn into `9.88E+09`.
- **Opt-out:** to stop all messages and calls to a parent, set `opted_out` to true in the Supabase
  Table Editor. Re-uploading the CSV never resets it.

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

## Known limitations

- If the backend restarts while a campaign is sending, unsent messages stay `queued` and are not
  resent (parents without WhatsApp are still called).
- The IVR fallback only acts on messages from the last 48 hours, so a long cron outage does not
  cause calls about old announcements.
- WhatsApp button and reply field names (`ButtonPayload`, `Body`, `OriginalRepliedMessageSid`)
  follow Twilio's docs. Check the first real payloads in `message_events` and adjust
  `backend/app/routers/webhooks.py` if they differ.
