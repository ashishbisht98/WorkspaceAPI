import { ensureSchema, sql } from "./db";
import { RenameRequest, RenameRequestStatus, RenameRequestType } from "./types";

type RenameRequestRow = {
  id: string;
  employee_id: string;
  request_type: RenameRequestType;
  current_email: string | null;
  note: string | null;
  status: RenameRequestStatus;
  admin_note: string | null;
  processed_by: string | null;
  processed_at: string | null;
  created_at: string;
};

function toRenameRequest(row: RenameRequestRow): RenameRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    requestType: row.request_type,
    currentEmail: row.current_email,
    note: row.note,
    status: row.status,
    adminNote: row.admin_note,
    processedBy: row.processed_by,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  };
}

export async function createRenameRequest(input: {
  employeeId: string;
  requestType: RenameRequestType;
  currentEmail?: string;
  note?: string;
}): Promise<RenameRequest> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO rename_requests (employee_id, request_type, current_email, note)
    VALUES (${input.employeeId}, ${input.requestType}, ${input.currentEmail || null}, ${input.note || null})
    RETURNING *
  `) as RenameRequestRow[];
  return toRenameRequest(rows[0]);
}

export async function listRenameRequests(status?: RenameRequestStatus): Promise<RenameRequest[]> {
  await ensureSchema();
  const rows = (status
    ? await sql`SELECT * FROM rename_requests WHERE status = ${status} ORDER BY created_at DESC`
    : await sql`SELECT * FROM rename_requests ORDER BY (status = 'pending') DESC, created_at DESC`) as RenameRequestRow[];
  return rows.map(toRenameRequest);
}

export async function listRenameRequestsByEmployeeId(employeeId: string): Promise<RenameRequest[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM rename_requests WHERE employee_id = ${employeeId} ORDER BY created_at DESC
  `) as RenameRequestRow[];
  return rows.map(toRenameRequest);
}

export async function getRenameRequestById(id: string): Promise<RenameRequest | null> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM rename_requests WHERE id = ${id}`) as RenameRequestRow[];
  return rows[0] ? toRenameRequest(rows[0]) : null;
}

export async function markRenameRequestProcessed(
  id: string,
  status: "approved" | "rejected",
  adminNote?: string,
): Promise<RenameRequest | null> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE rename_requests
    SET status = ${status}, admin_note = ${adminNote || null}, processed_by = 'admin', processed_at = now()
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
  `) as RenameRequestRow[];
  return rows[0] ? toRenameRequest(rows[0]) : null;
}
