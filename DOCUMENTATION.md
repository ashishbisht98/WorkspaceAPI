# Workspace Provisioner — Documentation

Full reference for every API endpoint, UI action button, and the library
functions behind them. For deployment/setup steps, see `README.md`.

## 1. Auth model

Two independent auth layers, enforced in `src/proxy.ts`:

| Path prefix | Auth | Behavior on failure |
|---|---|---|
| `/admin/*`, `/api/admin/*`, and the admin-only API routes below | `admin_session` httpOnly cookie (JWT, 12h TTL), set by `POST /api/admin/login` | Page routes redirect to `/admin/login`; API routes return `401 { "error": "Unauthorized" }` |
| every other `/api/*` route | `API_SECRET_TOKEN` env var, sent as `Authorization: Bearer <token>` or `x-api-key: <token>` | `401` with a `WWW-Authenticate` header. If `API_SECRET_TOKEN` is unset, these routes are open. |

`/admin/login` and `/api/admin/login` are always public (needed to sign in). The root path `/` is a server-side redirect to `/admin` — there is no unauthenticated UI page.

**Admin-only API routes**: the account-management routes behind the "Manage accounts" tab require the `admin_session` cookie instead of `API_SECRET_TOKEN`, matched by prefix in `ADMIN_ONLY_API_PATH_PREFIXES` (`src/proxy.ts`):
- `/api/employee` (covers `/api/employee`, `/api/employee/check`, `/api/employee/check-old-mail`)
- `/api/workspace-email`
- `/api/process`
- `/api/tablet` (covers `/api/tablet/details`, `/api/tablet/unregister`)
- `/api/guest` (covers `/api/guest/password-reset`)
- `/api/workspace-alias` (covers `/api/workspace-alias/remove`)

These no longer accept `API_SECRET_TOKEN` at all — only a signed-in admin session. The self-service routes (`/api/request-activation`, `/api/request-status`) are intentionally **not** in this list — employees must be able to reach them without an admin login, so they stay on the `API_SECRET_TOKEN` gate.

## 2. Core data types (`src/lib/types.ts`)

- **`EmployeeData`** — `employeeId`, `firstName`, `lastName?`, `fullName`, `mobile`, `personalEmail`, `employeeType?`, `schoolId?`, `macId?`. Sourced from the external employee API (`src/lib/employeeApi.ts`).
- **`WorkspaceAccount`** — `primaryEmail`, `fullName`, `suspended`, `orgUnitPath?`, `lastLoginTime?`, `isNewFormat` (matches `employeeid.firstname@domain` pattern).
- **`RenameRequest`** — `id`, `employeeId`, `requestType` (`0 | 1` — `0` = creation, `1` = reactivation), `currentEmail` (nullable — only set for `requestType: 1`), `note`, `status` (`"pending" | "approved" | "rejected"`), `adminNote`, `processedBy`, `processedAt`, `createdAt`.
- **`ActionTaken`** — outcome of a provisioning run: `"created" | "renamed" | "updated" | "manual_review_multiple_accounts" | "error"`.

## 3. API Reference

All request bodies are JSON unless noted. All routes run on the Node runtime (`export const runtime = "nodejs"`), not Edge.

### 3.1 Employee & Workspace lookup

#### `POST /api/employee`
Fetch raw employee data from the employee API and compute the expected new-format Workspace username. No Workspace lookup.

Request:
```json
{ "employeeId": "20192794" }
```
Response `200`:
```json
{
  "employee": {
    "employeeId": "20192794",
    "firstName": "Ashish",
    "lastName": "Bisht",
    "fullName": "Ashish Bisht",
    "mobile": "9876543210",
    "personalEmail": "ashish@example.com"
  },
  "expectedUsername": "20192794.ashish@doe.delhi.gov.in",
  "logs": ["Fetching employee data for 20192794...", "Found: Ashish Bisht (9876543210, ashish@example.com)", "Expected new-format username: 20192794.ashish@doe.delhi.gov.in"]
}
```
Errors: `400` invalid employee ID, `404` `{ "error": "Employee 20192794 not found" }`, `500` unexpected.

#### `GET|POST /api/employee/check`
Look up a Workspace account purely by employee ID (`employeeid.*` pattern), no external employee API call.

Request: `GET /api/employee/check?employeeId=20192794` or `POST` body `{ "employeeId": "20192794" }`.

Response `200`:
```json
{
  "employeeId": "20192794",
  "requestedEmail": "20192794.ashish@doe.delhi.gov.in",
  "found": true,
  "account": {
    "primaryEmail": "20192794.ashish@doe.delhi.gov.in",
    "fullName": "Ashish Bisht",
    "suspended": false,
    "orgUnitPath": "/",
    "lastLoginTime": "2026-07-15T10:07:03.000Z",
    "isNewFormat": true
  },
  "logs": ["Checking Workspace accounts for employee ID 20192794..."]
}
```
Errors: `400` if employee ID isn't exactly 8 digits.

#### `GET|POST /api/employee/check-old-mail`
Look up a Workspace account by an arbitrary email address (used to verify an old/legacy email still exists), with no employee-ID fallback.

Request: `GET /api/employee/check-old-mail?email=old.user@doe.delhi.gov.in` or `POST` body `{ "email": "old.user@doe.delhi.gov.in" }`.

Response `200` (found):
```json
{
  "requestedEmail": "20171146.sheetal@doe.delhi.gov.in",
  "found": true,
  "account": {
    "primaryEmail": "20171146.sheetal@doe.delhi.gov.in",
    "fullName": "Mrs Sheetal",
    "suspended": false,
    "orgUnitPath": "/Teachers/Delhi/North West B/Zone-11/Teacher",
    "lastLoginTime": "2025-03-21T13:16:26.000Z",
    "isNewFormat": true
  },
  "logs": ["Checking Workspace for 20171146.sheetal@doe.delhi.gov.in...", "Found 20171146.sheetal@doe.delhi.gov.in."]
}
```
Not found: `{ "found": false, "account": null, ... }` (still `200`). Errors: `400` invalid email format.

#### `POST /api/workspace-email`
Look up a Workspace account by a specific old email; if not found there, falls back to searching by employee ID. Also computes `isNewFormat` against the given `firstName`.

Request:
```json
{
  "employeeId": "20192794",
  "firstName": "Ashish",
  "oldWorkspaceEmail": "old.user@doe.delhi.gov.in"
}
```
Response `200`:
```json
{
  "requestedEmail": "old.user@doe.delhi.gov.in",
  "account": { "primaryEmail": "...", "fullName": "...", "suspended": false, "isNewFormat": false },
  "logs": ["Checking Workspace account old.user@doe.delhi.gov.in...", "Found ..."]
}
```
Errors: `400` invalid employee ID / missing `firstName` / missing `oldWorkspaceEmail`.

### 3.2 Provisioning

#### `POST /api/process`
The core create/rename/reactivate engine (`src/lib/provision.ts: provisionEmployee`). Only `employeeId` is required; other fields override auto-detected values.

Request:
```json
{
  "employeeId": "20192794",
  "oldWorkspaceEmail": "old.user@doe.delhi.gov.in",
  "fullName": "Ashish Bisht",
  "targetWorkspaceEmail": "20192794.ashish@doe.delhi.gov.in"
}
```

Decision logic, based on how many existing Workspace accounts match the employee:
- **0 matches** → `createAccount()` a fresh new-format account, temp password + forced change, `sendAccountCreatedEmail`. `action: "created"`.
- **1 match, already new-format** → `updateContactAndRecovery()` + new temp password + `sendPasswordResetEmail`. `action: "updated"`.
- **1 match, old-format** → update contact info, set temp password, `renameAccount()` to the new-format address, `sendAccountRenamedEmail`. `action: "renamed"`.
- **>1 matches** → no changes made, `action: "manual_review_multiple_accounts"`.

Response `200`:
```json
{
  "employee": { "employeeId": "20192794", "fullName": "Ashish Bisht", "mobile": "...", "personalEmail": "..." },
  "expectedUsername": "20192794.ashish@doe.delhi.gov.in",
  "matchedAccounts": [{ "primaryEmail": "old.user@doe.delhi.gov.in", "fullName": "...", "suspended": false, "isNewFormat": false }],
  "action": "renamed",
  "message": "Renamed old.user@doe.delhi.gov.in to 20192794.ashish@doe.delhi.gov.in, updated contact info, and emailed a password reset to ashish@example.com.",
  "finalAccount": { "primaryEmail": "20192794.ashish@doe.delhi.gov.in", "isNewFormat": true, "suspended": false, "fullName": "..." },
  "tempPasswordEmailSent": true,
  "logs": ["Fetching employee data for 20192794...", "..."]
}
```
Errors: via `ProvisionError` — `400` invalid ID / missing personal email / invalid target email, `404` employee not found, `500` unexpected (each includes `logs`).

### 3.3 Alias management

#### `POST /api/workspace-alias/remove`
Removes one or more old email aliases from whatever Workspace account currently owns them. No emails are sent.

Request:
```json
{ "oldWorkspaceEmails": ["old.name@doe.delhi.gov.in", "another.old@doe.delhi.gov.in"] }
```
Response `200`:
```json
{
  "total": 2,
  "removed": 1,
  "failed": 1,
  "results": [
    { "email": "old.name@doe.delhi.gov.in", "status": "removed", "primaryEmail": "20192794.ashish@doe.delhi.gov.in", "message": "Removed from 20192794.ashish@doe.delhi.gov.in." },
    { "email": "another.old@doe.delhi.gov.in", "status": "failed", "message": "No Workspace account was found for this email." }
  ],
  "message": "Removed 1 alias; 1 failed.",
  "logs": ["Resolving Workspace account for alias old.name@doe.delhi.gov.in...", "..."]
}
```
Errors: `400` no emails given, or one or more emails invalid.

### 3.4 Tablet & guest teacher (DOE tablet registration system)

#### `POST /api/tablet/details`
Fetches tablet registration + employee profile for an ID (8-digit government employee or longer guest-teacher ID).

Request: `{ "employeeId": "2019279412" }` (`employeeType` optional override).

Response `200`:
```json
{
  "employeeId": "2019279412",
  "employeeType": "guest",
  "employee": { "fullName": "...", "mobile": "...", "personalEmail": "..." },
  "tabletRegistration": {
    "employeeId": "2019279412",
    "employeeType": "guest",
    "name": "...",
    "mobile": "...",
    "email": "...",
    "schoolId": "1234",
    "registeredDeviceId": "AA:BB:CC:DD:EE:FF"
  },
  "logs": ["Fetching tablet registration details for 2019279412...", "..."]
}
```
Errors: `400` invalid ID (must be 8–10 digits), `404` if no tablet registration and ID is exactly 8 digits (government employees are expected to always have a record).

#### `POST /api/tablet/unregister`
De-registers the device tied to an employee/guest-teacher ID and emails a notification.

Request:
```json
{
  "employeeId": "2019279412",
  "employeeType": "guest",
  "personalEmail": "employee@example.com",
  "fullName": "Ashish Bisht"
}
```
`employeeType`, `personalEmail`, `fullName` are optional — the API resolves missing ones via `fetchEmployeeData`.

Response `200`: `{ "message": "Device AA:BB:CC:DD:EE:FF registered for guest teacher with employee ID 2019279412 was de-registered successfully. Notification email sent to employee@example.com." }`

Errors: `400` invalid ID, `404` no registration / no device found, `409` DOE reported success but the device is still showing as registered, `502` unrecognized DOE response.

#### `POST /api/guest/password-reset`
Resets a guest teacher's tablet-app password (defaults new password to `"New"`).

Request: `{ "employeeId": "2019279412", "newPassword": "New" }` (`newPassword` optional).

Response `200`: `{ "message": "Password reset to 'New'" }`. Errors: `400` invalid ID, `502` if the DOE backend didn't confirm success.

### 3.5 Rename / creation requests (employee self-service)

#### `POST /api/request-activation`
Employee-submitted request to either create a brand-new Workspace account or reactivate/rename an existing one. Goes into a `pending` queue for admin review.

`requestType` is an integer: **`0` = creation, `1` = reactivation**.

Request — creation (`requestType: 0`, no existing account):
```json
{
  "employeeId": "20192794",
  "requestType": 0,
  "note": "New joiner, no prior Workspace account."
}
```
Request — reactivation (`requestType: 1`, `currentEmail` required):
```json
{
  "employeeId": "20171146",
  "requestType": 1,
  "currentEmail": "241644.sheetal@doe.delhi.gov.in",
  "note": "Old account was under a stale employee ID prefix."
}
```
Response `201`:
```json
{
  "request": {
    "id": "3f2a9c10-4b1e-4a7d-9c2e-1a2b3c4d5e6f",
    "employeeId": "20171146",
    "requestType": 1,
    "currentEmail": "241644.sheetal@doe.delhi.gov.in",
    "note": "Old account was under a stale employee ID prefix.",
    "status": "pending",
    "adminNote": null,
    "processedBy": null,
    "processedAt": null,
    "createdAt": "2026-08-04T09:12:03.000Z"
  }
}
```
Validation: `requestType` must be `0` or `1` (`400` otherwise); `currentEmail` is required and validated when `requestType` is `1`, optional (but still validated if present) when `requestType` is `0`. The target Workspace email is decided later by the admin during review (`POST /api/admin/rename-requests/{id}/approve`), not submitted with the request.

#### `GET /api/request-status`
Lets an employee list and track every request filed under their employee ID (both types, all statuses).

Request: `GET /api/request-status?employeeId=20171146`

Response `200`:
```json
{
  "requests": [
    {
      "id": "3f2a9c10-4b1e-4a7d-9c2e-1a2b3c4d5e6f",
      "employeeId": "20171146",
      "requestType": 1,
      "currentEmail": "241644.sheetal@doe.delhi.gov.in",
      "note": "Old account was under a stale employee ID prefix.",
      "status": "pending",
      "adminNote": null,
      "processedBy": null,
      "processedAt": null,
      "createdAt": "2026-08-04T09:12:03.000Z"
    }
  ]
}
```
Newest first; `{ "requests": [] }` if none exist. Errors: `400` invalid employee ID.

### 3.6 Admin

All routes below require the `admin_session` cookie (sign in via `POST /api/admin/login` first).

#### `POST /api/admin/login`
Request: `{ "password": "..." }` (checked against `ADMIN_PASSWORD` with a timing-safe comparison). On success, sets the `admin_session` cookie (12h) and returns `{ "ok": true }`. `401 { "error": "Incorrect password." }` on failure.

#### `POST /api/admin/logout`
No body. Clears the session cookie, returns `{ "ok": true }`.

#### `GET /api/admin/rename-requests`
Lists requests for the review queue, optionally filtered by status.

Request: `GET /api/admin/rename-requests?status=pending` (`status` one of `pending|approved|rejected`; omit for all, pending-first).

Response `200`: `{ "requests": [ /* RenameRequest[] */ ] }`

#### `POST /api/admin/employee-lookup`
Combines `fetchEmployeeData` + an old-account Workspace lookup in one call — used to prefill the review form for a pending request.

Request: `{ "employeeId": "20171146", "currentEmail": "241644.sheetal@doe.delhi.gov.in" }` (`currentEmail` optional — omit for creation requests).

Response `200`:
```json
{
  "employee": { "employeeId": "20171146", "fullName": "Mrs Sheetal", "mobile": "...", "personalEmail": "..." },
  "expectedUsername": "20171146.sheetal@doe.delhi.gov.in",
  "oldWorkspaceAccount": { "primaryEmail": "241644.sheetal@doe.delhi.gov.in", "fullName": "Mrs Sheetal", "suspended": false, "isNewFormat": false },
  "logs": ["Fetching employee data for 20171146...", "..."]
}
```
Errors: `400` invalid employee ID, `404` employee not found.

#### `POST /api/admin/rename-requests/{id}/approve`
Runs the full `provisionEmployee()` flow (same engine as `/api/process`) using the request's `employeeId`/`currentEmail`, then marks the request `approved`.

Request: `{ "fullName": "Mrs Sheetal", "targetWorkspaceEmail": "20171146.sheetal@doe.delhi.gov.in", "adminNote": "Verified against HR record." }`

Response `200`: `{ "request": { /* updated RenameRequest, status: "approved" */ }, "result": { /* ProcessResult, same shape as /api/process */ } }`

Errors: `404` request not found, `409` request already processed, plus any `ProvisionError` from the underlying provisioning run.

#### `POST /api/admin/rename-requests/{id}/reject`
Request: `{ "adminNote": "Employee ID doesn't match HR records." }` (optional).

Response `200`: `{ "request": { /* updated RenameRequest, status: "rejected" */ } }`. Errors: `404`, `409`.

### 3.7 Feature kill switch

A single boolean flag (`kill_switch` table, one row, see §5) that lets an admin disable a feature without a deploy. Reads/writes go through `src/lib/killSwitch.ts` (`getKillSwitchEnabled`, `setKillSwitchEnabled`).

#### `GET /api/kill-switch`
Public read endpoint — not under `/api/admin`, so it's on the generic `API_SECRET_TOKEN` gate (see §1), not the admin session.

Response `200`: `{ "enabled": true }`

#### `GET /api/admin/kill-switch`
Admin-only (`admin_session` cookie, enforced by the proxy). Returns the current state.

Response `200`: `{ "enabled": true }`

#### `POST /api/admin/kill-switch`
Admin-only. Sets the flag.

Request: `{ "enabled": false }`

Response `200`: `{ "enabled": false }`. Errors: `400 { "error": "\`enabled\` must be a boolean." }`.

## 4. UI pages and action-button flows

`/` (`src/app/page.tsx`) is not a page — it's a server-side `redirect("/admin")`. All UI lives behind admin auth now; there is no unauthenticated page.

### 4.1 Admin login (`/admin/login`)

| Button | Calls | Result |
|---|---|---|
| **Sign in** | `POST /api/admin/login` | On success, redirects to `?next=` target or `/admin` |

### 4.2 Admin dashboard (`/admin`, `src/app/admin/page.tsx`)

The dashboard has two tabs, switched client-side (no route change):

- **Rename requests** — the approval queue (default tab).
- **Manage accounts** — the account-management form, rendered by `src/app/admin/ManageAccountsPanel.tsx`.

| Button | Calls | Underlying function(s) | Result |
|---|---|---|---|
| **Feature: On / Feature: Off** (header, next to Sign out) | `GET /api/admin/kill-switch` on load, `POST /api/admin/kill-switch` on click | `getKillSwitchEnabled`, `setKillSwitchEnabled` | Toggles the [feature kill switch](#37-feature-kill-switch); button reflects current state, hidden until the initial `GET` resolves |
| **Sign out** | `POST /api/admin/logout` | — | Clears session cookie, redirects to `/admin/login` |

#### "Rename requests" tab

| Button | Calls | Underlying function(s) | Result |
|---|---|---|---|
| **Pending / Approved / Rejected / All** filter tabs | `GET /api/admin/rename-requests?status=...` | `listRenameRequests` | Refreshes the request list |
| **Review** (only on pending requests) | `POST /api/admin/employee-lookup` | `fetchEmployeeData`, `findWorkspaceAccountByEmail` | Opens the review panel, prefilled with employee ID, mobile, personal email, and — for `requestType: 1` (reactivation) requests — the old Workspace email + its account's full name |
| **Rename & Activate** (approve) | `POST /api/admin/rename-requests/{id}/approve` | `provisionEmployee`, `markRenameRequestProcessed` | Runs create/rename/reactivate, marks request `approved`, shows outcome message |
| **Reject** | `POST /api/admin/rename-requests/{id}/reject` | `markRenameRequestProcessed` | Marks request `rejected` |
| **Close** | (local state only) | — | Collapses the review panel without submitting |

The review panel is split into two sections:
- **Employee details** (read-only, from `POST /api/admin/employee-lookup`): Employee ID, Full Name, Mobile number, Email (personal email).
- **Workspace details**: Full name (editable — what gets set on the Workspace account), Old Workspace email (read-only, shown only when `requestType` is `1`/reactivation), Target new email (editable).

#### "Manage accounts" tab

| Button | Calls | Underlying function(s) | Result |
|---|---|---|---|
| **Get Details** | `POST /api/employee`, then (if "Old Workspace email" filled) `POST /api/workspace-email` | `fetchEmployeeData`, `findWorkspaceAccountByEmail` | Shows `EmployeeDetailsPanel`: editable name + target-username fields, read-only old-account info |
| **Tab details** | `POST /api/tablet/details` | `fetchTabletRegistrationDetailsForEmployee`, `fetchEmployeeData` | Shows `TabletDetailsPanel` with registration + de-register/reset actions |
| **Create Account / Rename & Activate / Activate account** (label depends on whether an old account was found and whether it already matches the target) | `POST /api/process` | `provisionEmployee` | Shows `ResultPanel` with the outcome, matched accounts, and processing log |
| **De-register employee** (inside Tab details) | `POST /api/tablet/unregister` | `callDoeTabletApi`, `sendTabletDeregisteredEmail` | Inline success/failure message |
| **Reset guest teacher password** (inside Tab details, only shown for IDs >8 digits) | `POST /api/guest/password-reset` | `callDoeTabletApi` | Inline success/failure message |
| **Remove aliases** | `POST /api/workspace-alias/remove` | `removeAliasByEmail` (looped per email) | Per-email removed/failed list |

## 5. Database

Single Postgres table `rename_requests` (Neon, via `DATABASE_URL`), schema managed idempotently by `ensureSchema()` in `src/lib/db.ts`:

```
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
employee_id    TEXT NOT NULL
request_type   INTEGER NOT NULL DEFAULT 1              -- 0 = creation, 1 = reactivation
current_email  TEXT                                    -- nullable; required only for reactivation
requested_email TEXT                                    -- unused; column kept for backward compat, no longer read/written by the app
note           TEXT
status         TEXT NOT NULL DEFAULT 'pending'          -- 'pending' | 'approved' | 'rejected'
admin_note     TEXT
processed_by   TEXT
processed_at   TIMESTAMPTZ
created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```
Indexed on `(status, created_at DESC)` for the admin queue.

Single-row table `kill_switch`, backing the [feature kill switch](#37-feature-kill-switch):

```
id             INTEGER PRIMARY KEY              -- always 1
enabled        BOOLEAN NOT NULL DEFAULT true
updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```
Seeded with `(1, true)` on first run via `ON CONFLICT (id) DO NOTHING`.

## 6. Notifications

`src/lib/email.ts` (via SMTP env vars) sends:
- **Account created** — new-format email + temp password, to the employee's personal email.
- **Account renamed** — old → new email + temp password.
- **Password reset** — temp password for an already-new-format account.
- **Tablet de-registered** — confirmation after `/api/tablet/unregister`.
