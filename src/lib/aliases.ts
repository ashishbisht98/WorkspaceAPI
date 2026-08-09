import { ensureSchema, sql, sqlQuery } from "./db";
import { AliasRecord } from "./types";

type AliasRow = {
  id: string;
  employee_id: string;
  old_email: string;
  new_email: string;
  request_id: string | null;
  created_at: string;
};

function toAlias(row: AliasRow): AliasRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    oldEmail: row.old_email,
    newEmail: row.new_email,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}

/** Idempotent — a stale/duplicate call for the same old_email is a no-op (returns null). */
export async function createAliasRecord(input: {
  employeeId: string;
  oldEmail: string;
  newEmail: string;
  requestId: string;
}): Promise<AliasRecord | null> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO alias (employee_id, old_email, new_email, request_id)
    VALUES (${input.employeeId}, ${input.oldEmail.toLowerCase()}, ${input.newEmail.toLowerCase()}, ${input.requestId})
    ON CONFLICT (old_email) DO NOTHING
    RETURNING *
  `) as AliasRow[];
  return rows[0] ? toAlias(rows[0]) : null;
}

export async function listAliases(): Promise<AliasRecord[]> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM alias ORDER BY created_at DESC`) as AliasRow[];
  return rows.map(toAlias);
}

export async function getAliasesByIds(ids: string[]): Promise<AliasRecord[]> {
  if (ids.length === 0) return [];
  await ensureSchema();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const rows = (await sqlQuery(`SELECT * FROM alias WHERE id IN (${placeholders})`, ids)) as AliasRow[];
  return rows.map(toAlias);
}

export async function deleteAliasRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureSchema();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  await sqlQuery(`DELETE FROM alias WHERE id IN (${placeholders})`, ids);
}
