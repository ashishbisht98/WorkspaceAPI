import { ensureSchema, sql } from "./db";

const KILL_SWITCH_ID = 1;

export async function getKillSwitchEnabled(): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    SELECT enabled FROM kill_switch WHERE id = ${KILL_SWITCH_ID}
  `) as { enabled: boolean }[];
  return rows[0]?.enabled ?? true;
}

export async function setKillSwitchEnabled(enabled: boolean): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE kill_switch SET enabled = ${enabled}, updated_at = now()
    WHERE id = ${KILL_SWITCH_ID}
    RETURNING enabled
  `) as { enabled: boolean }[];
  return rows[0]?.enabled ?? enabled;
}
