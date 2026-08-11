import { neon, NeonQueryFunction } from "@neondatabase/serverless";

let cachedSql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (!cachedSql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Attach a Postgres database to this project in Vercel, then `vercel env pull`.",
      );
    }
    cachedSql = neon(url);
  }
  return cachedSql;
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return getSql()(strings, ...values);
}

/** For queries whose shape (WHERE clauses, ORDER BY direction) varies at runtime — use `$1`, `$2`, ... placeholders. */
export function sqlQuery(text: string, params: unknown[] = []) {
  return getSql().query(text, params);
}

let schemaReady: Promise<void> | null = null;

/** Idempotent — safe to call at the top of every request handler that touches the DB. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS rename_requests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          employee_id TEXT NOT NULL,
          request_type INTEGER NOT NULL DEFAULT 1,
          current_email TEXT,
          requested_email TEXT,
          note TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          admin_note TEXT,
          processed_by TEXT,
          processed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Migrations for tables created before request_type existed / current_email was required.
      await sql`ALTER TABLE rename_requests ADD COLUMN IF NOT EXISTS request_type INTEGER NOT NULL DEFAULT 1`;
      // request_type used to be TEXT ('creation'/'reactivation'); convert in place if still text.
      await sql`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'rename_requests' AND column_name = 'request_type' AND data_type = 'text'
          ) THEN
            ALTER TABLE rename_requests
              ALTER COLUMN request_type DROP DEFAULT;
            ALTER TABLE rename_requests
              ALTER COLUMN request_type TYPE INTEGER
              USING (CASE WHEN request_type = 'creation' THEN 0 ELSE 1 END);
            ALTER TABLE rename_requests
              ALTER COLUMN request_type SET DEFAULT 1;
          END IF;
        END $$
      `;
      await sql`ALTER TABLE rename_requests ALTER COLUMN current_email DROP NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS rename_requests_status_idx ON rename_requests (status, created_at DESC)`;

      // Cached employee details from the submitting app, so the admin review
      // panel can skip the live employee-lookup call. Nullable — old app
      // builds and requests submitted before this column existed just don't
      // populate them, and the admin panel falls back to a live lookup.
      await sql`ALTER TABLE rename_requests ADD COLUMN IF NOT EXISTS full_name TEXT`;
      await sql`ALTER TABLE rename_requests ADD COLUMN IF NOT EXISTS personal_email TEXT`;
      await sql`ALTER TABLE rename_requests ADD COLUMN IF NOT EXISTS mobile TEXT`;

      // kill_switch table retired — the flag now lives in Vercel Edge Config
      // (src/lib/killSwitch.ts), since it was the single most-invoked route
      // and Edge Config reads don't cost a Function Invocation. Not dropped
      // here to avoid touching existing data; safe to drop manually.

      // Old addresses kept as Workspace aliases after a rename/reactivation
      // (see renameAccount() in googleAdmin.ts), pending manual cleanup from
      // the admin panel's Alias tab.
      await sql`
        CREATE TABLE IF NOT EXISTS alias (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          employee_id TEXT NOT NULL,
          old_email TEXT NOT NULL,
          new_email TEXT NOT NULL,
          request_id UUID REFERENCES rename_requests (id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS alias_old_email_idx ON alias (old_email)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
