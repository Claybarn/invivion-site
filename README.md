# invivion.bio

The brand landing page for Invivion.

- `site/` is the static page, published to GitHub Pages by `.github/workflows/pages.yml`.
- `worker/` is a Cloudflare Worker at `api.invivion.bio` that handles the two forms. It checks a
  Turnstile token on every submission, then calls Resend:
  - `POST /subscribe` adds the email as a Resend contact (optionally in a segment).
  - `POST /contact` emails the message to `CONTACT_TO`, with reply-to set to the sender.

Only the Worker holds secrets. The page holds the public Turnstile site key and nothing else.

## Setup

### 1. Resend
1. Add the `invivion.bio` domain in Resend and add its DNS records (SPF/DKIM) at Cloudflare.
2. Create an API key with sending and contacts access.
3. Optional: create a segment for the mailing list (Audience → Segments) and copy its ID into
   `RESEND_SEGMENT_ID` in `worker/wrangler.jsonc`.
4. Set `MAIL_FROM` and `CONTACT_TO` in `worker/wrangler.jsonc` to the company address once it exists.

### 2. Turnstile
1. In Cloudflare, go to Turnstile → Add widget, add hostnames `invivion.bio` and `www.invivion.bio`,
   and choose Managed mode.
2. Copy the **site key** into `turnstileSiteKey` in `site/index.html`. The placeholder there is
   Cloudflare's always-pass test key, which the production Worker rejects.
3. Keep the **secret key** for the next step.

### 3. Worker
```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```
The `api.invivion.bio` custom domain needs the `invivion.bio` zone on Cloudflare. If DNS lives
elsewhere, delete `routes` from `wrangler.jsonc`, deploy to `*.workers.dev`, and point
`window.INVIVION.api` in `site/index.html` at that URL instead.

### 4. GitHub Pages
1. Push this repo to GitHub, then go to Settings → Pages → Source: **GitHub Actions**.
2. Settings → Pages → Custom domain: `invivion.bio`, then turn on **Enforce HTTPS** once the
   certificate is issued. (When Pages deploys from Actions, it ignores `site/CNAME` and uses this
   setting instead.)
3. DNS at Cloudflare, set to **DNS only** (grey cloud) so GitHub can issue the certificate:
   - `A` records for `invivion.bio` → `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153`
   - `CNAME` for `www` → `<github-user>.github.io`
4. Recommended: verify the domain under your GitHub account's Pages settings to block takeover.

## Local development
```bash
cd worker && cp .dev.vars.example .dev.vars && npx wrangler dev --port 8799
cd site && python3 -m http.server 8000
```
For local testing, set `window.INVIVION.api` to `http://localhost:8799`. Locally the Turnstile test
key always passes. Resend calls fail until `.dev.vars` holds a real key.
