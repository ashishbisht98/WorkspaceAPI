# Workspace Provisioner

Next.js API routes for employee lookup, Google Workspace provisioning, alias removal, tablet registration lookup, tablet deregistration, and guest password reset.

## Deploy To Vercel

1. Import this repository into Vercel as a Next.js project.
2. Add the environment variables from `.env.example` in Vercel Project Settings.
3. Set `API_SECRET_TOKEN` to a long random value if the API will be reachable from the internet.
4. Deploy.

The app mostly uses Node.js route handlers, not Edge functions, because it depends on `googleapis` and `nodemailer`. The one exception is `/api/kill-switch`, which runs on the edge runtime against Vercel Edge Config (see below) — it was the single most-invoked route, and moving it off Serverless Functions avoids burning through the Function Invocation quota.

## Kill switch (Vercel Edge Config)

The feature kill switch (`/api/kill-switch`, `/api/admin/kill-switch`) is backed by Vercel Edge Config instead of Postgres, since it's read far more often than anything else in the app. One-time setup (Vercel CLI, run from the project root once linked with `vercel link`):

```bash
vercel edge-config add killswitch-config
# Note the printed "id" (ecfg_...) as EDGE_CONFIG_ID below.

vercel edge-config tokens killswitch-config --add production-read --format json
# Build EDGE_CONFIG from the printed id + token:
#   https://edge-config.vercel.com/<id>?token=<token>

vercel env add EDGE_CONFIG production --value "<connection string above>" --yes
vercel env add EDGE_CONFIG preview "" --value "<connection string above>" --yes --non-interactive
vercel env add EDGE_CONFIG development --value "<connection string above>" --yes

vercel env add EDGE_CONFIG_ID production --value "<ecfg_...>" --yes
vercel env add VERCEL_TEAM_ID production --value "<orgId from .vercel/project.json>" --yes
# repeat both for preview/development the same way as EDGE_CONFIG above

# Seed the initial value:
vercel edge-config update <ecfg_...> --patch '[{"operation":"upsert","key":"killSwitchEnabled","value":true}]'
```

Writes (the admin toggle) go through Vercel's Management API, not the read-only `EDGE_CONFIG` connection string — that needs a separate token with write access:

- Create one at [vercel.com/account/tokens](https://vercel.com/account/tokens) and set it as `VERCEL_ACCESS_TOKEN`.
- Writes are eventually consistent (seconds, not instant) across edge nodes.

## Google Credentials

Use one of these Vercel environment variables:

- `GOOGLE_SERVICE_ACCOUNT_JSON`: the full service account JSON.
- `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`: the same JSON encoded as base64.

Also set `GOOGLE_ADMIN_IMPERSONATE_EMAIL` to the Workspace admin account used for domain-wide delegation.

Domain-wide delegation must authorize these scopes (Workspace Admin console → Security → API controls → Domain-wide delegation) for the service account's client ID:

- `https://www.googleapis.com/auth/admin.directory.user` — account create/rename/lookup.
- `https://www.googleapis.com/auth/admin.reports.usage.readonly` — per-account storage usage shown in the admin review panel. Usage reports typically lag 1-3 days, so this returns `null` for brand-new or just-renamed accounts until Google generates a report for them.

## API Auth

When `API_SECRET_TOKEN` is set, every `/api/*` request must include one of:

```bash
Authorization: Bearer <API_SECRET_TOKEN>
x-api-key: <API_SECRET_TOKEN>
```

If `API_SECRET_TOKEN` is empty, the API routes are unprotected.

## Endpoints

Most endpoints accept `POST` JSON; a few employee/status-check routes also accept `GET` with query params.

```bash
curl -X POST https://your-project.vercel.app/api/employee \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_SECRET_TOKEN" \
  -d '{"employeeId":"12345678"}'
```

See **[DOCUMENTATION.md](DOCUMENTATION.md)** for the full API reference (every endpoint, request/response JSON, error cases), the admin dashboard's request/review/approve flow, and the UI action-button-to-API mapping.
