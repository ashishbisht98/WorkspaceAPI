import { ensureSchema, sql, sqlQuery } from "./db";
import { RenameRequest, RenameRequestCursor, RenameRequestStatus, RenameRequestType } from "./types";

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

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
  full_name: string | null;
  personal_email: string | null;
  mobile: string | null;
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
    fullName: row.full_name,
    personalEmail: row.personal_email,
    mobile: row.mobile,
  };
}

export async function createRenameRequest(input: {
  employeeId: string;
  requestType: RenameRequestType;
  currentEmail?: string;
  note?: string;
  fullName?: string;
  personalEmail?: string;
  mobile?: string;
}): Promise<RenameRequest> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO rename_requests (employee_id, request_type, current_email, note, full_name, personal_email, mobile)
    VALUES (
      ${input.employeeId}, ${input.requestType}, ${input.currentEmail || null}, ${input.note || null},
      ${input.fullName || null}, ${input.personalEmail || null}, ${input.mobile || null}
    )
    RETURNING *
  `) as RenameRequestRow[];
  return toRenameRequest(rows[0]);
}

export function encodeRenameRequestCursor(cursor: RenameRequestCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeRenameRequestCursor(raw: string | null | undefined): RenameRequestCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<RenameRequestCursor>;
    if (typeof parsed.createdAtEpoch === "number" && typeof parsed.id === "string") {
      return { createdAtEpoch: parsed.createdAtEpoch, id: parsed.id };
    }
  } catch {
    // Malformed/tampered cursor — treat as "start from the beginning".
  }
  return null;
}

export interface ListRenameRequestsOptions {
  status?: RenameRequestStatus;
  /** Substring match against employee_id. */
  employeeId?: string;
  /** Inclusive, "YYYY-MM-DD" (local to the caller — interpreted as UTC day bounds). */
  startDate?: string;
  endDate?: string;
  cursor?: RenameRequestCursor | null;
  limit?: number;
}

/**
 * Keyset-paginated request listing, filterable by status/employee ID/date
 * range. Pending requests sort oldest-first (worked in FIFO order); every
 * other view (including "all") sorts newest-first.
 */
export async function listRenameRequests(
  options: ListRenameRequestsOptions = {},
): Promise<{ requests: RenameRequest[]; nextCursor: RenameRequestCursor | null }> {
  await ensureSchema();

  const { status, cursor } = options;
  const employeeId = options.employeeId?.trim();
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const direction: "ASC" | "DESC" = status === "pending" ? "ASC" : "DESC";

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (employeeId) {
    params.push(`%${employeeId}%`);
    conditions.push(`employee_id ILIKE $${params.length}`);
  }
  if (options.startDate) {
    params.push(`${options.startDate}T00:00:00.000Z`);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (options.endDate) {
    params.push(`${options.endDate}T23:59:59.999Z`);
    conditions.push(`created_at <= $${params.length}`);
  }
  if (cursor) {
    params.push(cursor.createdAtEpoch, cursor.id);
    const op = direction === "ASC" ? ">" : "<";
    // Compare against EXTRACT(EPOCH FROM created_at), not the raw column —
    // see RenameRequestCursor for why (avoids a string round-trip that
    // truncates TIMESTAMPTZ's microsecond precision to JS Date's
    // millisecond precision and re-matches the boundary row).
    conditions.push(`(EXTRACT(EPOCH FROM created_at), id) ${op} ($${params.length - 1}, $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit + 1); // fetch one extra row to know whether there's a next page

  const rows = (await sqlQuery(
    // ::double precision (not the numeric EXTRACT returns by default) so the
    // driver hands back a plain JS number, not a string — see the comment
    // on RenameRequestCursor for why that round-trip has to be lossless.
    `SELECT *, EXTRACT(EPOCH FROM created_at)::double precision AS created_at_epoch FROM rename_requests ${where} ORDER BY created_at ${direction}, id ${direction} LIMIT $${params.length}`,
    params,
  )) as (RenameRequestRow & { created_at_epoch: number | string })[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? { createdAtEpoch: Number(last.created_at_epoch), id: last.id } : null;

  return { requests: page.map(toRenameRequest), nextCursor };
}

export interface RenameRequestStatusCounts {
  pending: number;
  approved: number;
  rejected: number;
  all: number;
}

export async function getRenameRequestStatusCounts(): Promise<RenameRequestStatusCounts> {
  await ensureSchema();
  const rows = (await sql`
    SELECT status, COUNT(*)::int AS count FROM rename_requests GROUP BY status
  `) as { status: RenameRequestStatus; count: number }[];

  const counts: RenameRequestStatusCounts = { pending: 0, approved: 0, rejected: 0, all: 0 };
  for (const row of rows) {
    counts[row.status] = row.count;
    counts.all += row.count;
  }
  return counts;
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
