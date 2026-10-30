# Google Calendar (read-only display) - candidate, off by default

Status: candidate. Not enabled by any default, not a sync, not tested against real Google.
It was tested only against a fake Google in `tests/test_gcal.py`. The Docker install route
below has not been run (no Docker where it was written).

## What it does and does not do

- Shows your **primary** Google calendar events (title, time, all-day flag) read-only.
- Scope requested: `https://www.googleapis.com/auth/calendar.events.owned.readonly`
  ("see the events on Google calendars you own"). Google's calendarList.list does not accept
  this scope, so the app cannot list or choose calendars, and calendars shared with you are not
  covered. Only the primary calendar is read.
- Nothing is written to Google. Events are not stored on the server; they are fetched for the
  window you open (max 100 days, max 500 events, 10 pages, 25 s for the whole request including the token refresh; each call to Google is also capped to the time left, so the total cannot exceed the budget by a full call timeout) and the response says
  `truncated: true` with a `reason` when the list may be incomplete.
- Google's incremental `syncToken` cannot be combined with `timeMin`/`timeMax`, so it is not used.
- While your Google Cloud project is in "Testing" the refresh token expires after 7 days.
  You will need to reconnect about weekly. (Google: "refresh token expiring in 7 days".)

## Turn it on (self-host owner)

1. Install the extra package. Compose does not pass build arguments by itself, so edit the file you use
   (neither edit nor build has been executed; no Docker was available):
   - Repo-root `docker-compose.yml` (service `sync` has `build: ./server`): change it to
     `build: { context: ./server, args: { WITH_GOOGLE: "1" } }`.
   - `server/docker-compose.yml` (service has `build: .`): change it to
     `build: { context: ., args: { WITH_GOOGLE: "1" } }`.
   - Plain Docker, from the `server/` directory: `docker build --build-arg WITH_GOOGLE=1 .`.
   - Outside Docker: `pip install -r requirements-google.txt`.
2. In your own Google Cloud project: enable the Calendar API, configure the OAuth consent screen
   (External, Testing, add yourself as a test user), create an OAuth client of type "Web application"
   with the redirect URI below.
3. Create an encryption key and keep it in a file only the server can read:
   `python -m app.gcal_admin genkey > /run/secrets/lifedash_key && chmod 600 /run/secrets/lifedash_key`
4. Set: `SYNC_GOOGLE_ENABLED=1`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET_FILE`,
   `GOOGLE_REDIRECT_URI` (`https://your-host/api/google/callback`, or `http://localhost:PORT/...`
   for local use; other http URLs are refused), `SYNC_SECRET_KEYS_FILE`.
5. Open Settings and connect. `GET /api/google/status` says `available:false` with a `problem`
   text if something above is missing.

Do not expose the callback on a public host you do not control. It is rate-limited
(30 requests per minute per client address; behind a proxy that address is the proxy's) and gated
by a one-time state value, but it is an unauthenticated route.

## Keys: backup and rotation

- The refresh token is stored encrypted (Fernet). The key and the client secret are NOT in the
  database. Back them up separately from database backups and never in the same place; whoever has
  both can read the token.
- Losing the key is not data loss: users reconnect. A restored old database can bring back an old
  encrypted token; if you (or Google) revoked it since, the first use fails with `invalid_grant`
  and the link is removed.
- Rotate: put the NEW key first, keep the old one after a comma in `SYNC_SECRET_KEYS`, restart,
  run `python -m app.gcal_admin rotate`, then `python -m app.gcal_admin check`. Only when `check`
  exits 0 may you remove the old key. `check` exits 1 if some token needs rotating and 2 (never 0)
  if tokens are stored but `SYNC_SECRET_KEYS` is missing or invalid. (A token read with an older key is also re-wrapped
  automatically on its next use, but do not rely on that for tokens nobody uses.)
- The database also holds pending sign-in attempts (hashed state, PKCE verifier, 10 minute life).

## Disconnect

`POST /api/google/disconnect` always deletes the stored token and this user's pending sign-ins, and
cancels a sign-in that is already waiting on Google (its token is revoked instead of saved),
even if the feature is switched off or the key is gone. It returns `revoked: true` only when Google
confirmed revocation. If `revoked` is false, remove LifeDash yourself at
https://myaccount.google.com/permissions .

## Logs

The access log redacts `/feed/<token>.ics` and the callback query (`?code=...&state=...`). Reverse
proxies, CDNs and hosting logs keep their own copies: configure them to drop the query string for
`/api/google/callback`.
