# Self-host hardening

What the sync server does for you, and what your deployment must add.
Nothing here changes local-only operation: on a LAN or localhost the
defaults below are fine as shipped.

## The one hard requirement for internet exposure: TLS

Every credential in the system is a bearer token (session tokens and
agent API keys). Over plain HTTP on the internet they are fully
sniffable. The server speaks HTTP only; put a TLS-terminating reverse
proxy in front of it. Caddy is the simplest self-host option:

```
lifedash-sync.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Then bind the sync container to localhost only (see the commented lines
in docker-compose.yml) and point the app's Settings -> Sync at
`https://lifedash-sync.example.com`.

## What the server already does

- Passwords: PBKDF2-HMAC-SHA256, 200k iterations, per-user salt,
  constant-time compare.
- Session tokens: only the SHA-256 digest is stored (existing plaintext
  rows are migrated at startup and self-heal on first use), so a
  database-file read does not hand out live sessions.
- Agent API keys: SHA-256 digest stored, shown once at creation,
  revocable, scope- and project-limited.
- Registration: open for the first user only, then closed unless
  SYNC_OPEN_REGISTRATION=1.
- Login throttling: after 5 failed attempts for a (username, client IP)
  pair, further guesses back off exponentially (2s doubling to a 15
  minute cap) and are refused with 429 + Retry-After WITHOUT running
  the password check. Keying by address means spraying a known username
  from one place never throttles the same user signing in from another;
  the stated tradeoff is that from a throttled address even the correct
  password waits out the backoff. A success clears the counter. Existing
  session tokens are never affected by login failures. Unknown usernames
  pay the same password-hashing cost as known ones. Idle rows are pruned
  after 24h and the table is hard-capped (10k rows); at the cap the
  oldest un-armed rows are evicted, so a full table never turns
  throttling OFF for a new key.

  Client-IP resolution behind a proxy: X-Forwarded-For is honored only
  when SYNC_TRUSTED_PROXY_HOPS is set to the number of trusted proxies
  in front AND the direct peer is a trusted proxy address (loopback, or
  listed in SYNC_TRUSTED_PROXY_IPS). The client is then the entry the
  outermost trusted proxy recorded - the hops-th entry from the right.
  Entries further left are client-controlled and never used, so
  spoofing the header neither resets nor multiplies throttle keys.
  Caddy's reverse proxy replaces the inbound X-Forwarded-For by
  default, so hops=1 is correct as-is; stock nginx APPENDS
  ($proxy_add_x_forwarded_for), which is also correct with hops=1
  because the entry nginx appends is the rightmost one - but only if
  clients cannot reach the app port directly, so bind the app to
  loopback or firewall it off. Anyone reaching the app directly is
  keyed by their real peer address, which stays throttled per address.
  With hops unset, X-Forwarded-For is ignored and the socket peer is
  the key; behind an unconfigured proxy that collapses to one shared
  key per username - safe, just shared.

  Stated limit: keys are per address, so an attacker rotating many
  source addresses (botnets, IPv6 ranges) is bounded per address, not
  globally. For a personal single-user server with a long random
  password this is the deliberate stopping point; a global per-username
  ceiling was considered and left out, because it would let a
  distributed attacker slow the owner's own login.
- Request bodies: JSON endpoints reject a declared Content-Length above
  SYNC_MAX_BODY_MB (default 10) with 413 before parsing, and bodies
  sent without a Content-Length (chunked) are counted while streaming
  and cut off with 413 past the same limit. (A body is also bounded by
  its declared length at the HTTP parser, so a false small declaration
  delivers no extra bytes.) Attachment uploads are exempt from this cap
  and instead stream with their own per-file limit
  (SYNC_ATTACHMENT_MAX_FILE_MB, default 25) and a disk-measured total
  quota (SYNC_ATTACHMENT_QUOTA_MB, default 200, including retained
  deleted files).
- Attachment blob paths are built only from whitelisted ids; downloads
  send nosniff and attachment disposition.

## Environment knobs

| Variable | Default | Meaning |
| --- | --- | --- |
| SYNC_DB | /data/lifedash.db | SQLite file location |
| SYNC_BLOB_DIR | alongside the DB | attachment blob directory |
| SYNC_OPEN_REGISTRATION | 0 | 1 re-opens registration |
| SYNC_MAX_BODY_MB | 10 | JSON request body cap (MB) |
| SYNC_CORS_ORIGINS | * | comma-separated allowed browser origins |
| SYNC_TRUSTED_PROXY_HOPS | 0 | number of trusted proxies in front; 0 ignores X-Forwarded-For |
| SYNC_TRUSTED_PROXY_IPS | loopback | extra comma-separated proxy peer addresses allowed to supply X-Forwarded-For |
| SYNC_ATTACHMENT_QUOTA_MB | 200 | total attachment bytes, incl. deleted |
| SYNC_ATTACHMENT_MAX_FILE_MB | 25 | per-file upload cap |

## CORS

The app calls the API cross-origin with bearer tokens; there are no
ambient cookies, so the permissive default does not let a random
website ride a logged-in browser. Once your app origin is known, set
SYNC_CORS_ORIGINS to it (comma-separated if several) to shrink the
surface further.

## Still your responsibility

- TLS termination (above) and keeping the proxy current.
- Firewalling: only the proxy should be able to reach :8787.
- Backups of the SQLite file and blob directory.
