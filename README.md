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

## API Auth

When `API_SECRET_TOKEN` is set, every `/api/*` request must include one of:

```bash
Authorization: Bearer <API_SECRET_TOKEN>
x-api-key: <API_SECRET_TOKEN>
```

If `API_SECRET_TOKEN` is empty, the API routes are unprotected.

## Endpoints

All endpoints accept `POST` JSON.

```bash
curl -X POST https://your-project.vercel.app/api/employee \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_SECRET_TOKEN" \
  -d '{"employeeId":"12345678"}'
```

- `/api/employee`: fetch employee details and expected Workspace username.
- `/api/workspace-email`: look up a Workspace account by old email.
- `/api/process`: create, update, or rename a Workspace account.
- `/api/workspace-alias/remove`: remove one or more old Workspace aliases.
- `/api/tablet/details`: fetch tablet registration details.
- `/api/tablet/unregister`: deregister an employee tablet registration.
- `/api/guest/password-reset`: reset a guest teacher password to `New`.

### Request Bodies

`/api/employee`

```json
{ "employeeId": "12345678" }
```

`/api/workspace-email`

```json
{
  "employeeId": "12345678",
  "firstName": "Amit",
  "oldWorkspaceEmail": "old.user@example.gov.in"
}
```

`/api/process`

```json
{
  "employeeId": "12345678",
  "oldWorkspaceEmail": "old.user@example.gov.in",
  "fullName": "Amit Kumar",
  "targetWorkspaceEmail": "12345678.amit@example.gov.in"
}
```

Only `employeeId` is required. The other fields are overrides.

`/api/workspace-alias/remove`

```json
{ "oldWorkspaceEmails": ["old.user@example.gov.in"] }
```

`/api/tablet/details`

```json
{ "employeeId": "12345678" }
```

`/api/tablet/unregister`

```json
{
  "employeeId": "12345678",
  "employeeType": "government",
  "personalEmail": "employee@example.com",
  "fullName": "Amit Kumar"
}
```

`employeeType`, `personalEmail`, and `fullName` are optional. The API will try to resolve missing notification details.

`/api/guest/password-reset`

```json
{
  "employeeId": "1234567890",
  "newPassword": "New"
}
```
