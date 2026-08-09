# Workspace Provisioner

Next.js API routes for employee lookup, Google Workspace provisioning, alias removal, tablet registration lookup, tablet deregistration, and guest password reset.

## Deploy To Vercel

1. Import this repository into Vercel as a Next.js project.
2. Add the environment variables from `.env.example` in Vercel Project Settings.
3. Set `API_SECRET_TOKEN` to a long random value if the API will be reachable from the internet.
4. Deploy.

The app uses Node.js route handlers, not Edge functions, because it depends on `googleapis` and `nodemailer`.

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
