# Cloudflare result image relay

This private Worker lets an authenticated user's browser fetch a temporary UU
result and upload it back to Infinite Canvas for permanent job-file storage. It
avoids delaying the first preview when the application server cannot reach the
UU result CDN or `workers.dev` reliably.

Security properties:

- HMAC-signed requests with a maximum five-minute lifetime
- strict `img.uuapi.net/uu-image-temp/` allowlist
- no cross-host redirects
- image signature and 32 MiB size validation
- `Cache-Control: no-store`

Deploy from this directory:

```bash
npx wrangler login
npx wrangler secret put RESULT_IMAGE_RELAY_SECRET
npx wrangler deploy
```

Set the same secret on the application server together with the deployed
`/fetch` URL:

```dotenv
RESULT_IMAGE_RELAY_URL=https://infinite-canvas-result-relay.<account>.workers.dev/fetch
RESULT_IMAGE_RELAY_SECRET=<same-secret>
RESULT_IMAGE_RELAY_SERVER_DOWNLOAD=0
```

Keep `RESULT_IMAGE_RELAY_SERVER_DOWNLOAD=0` when only client browsers can reach
the Worker. Set it to `1` only when the application server has verified network
access to the Worker and should also attempt background recovery itself.
