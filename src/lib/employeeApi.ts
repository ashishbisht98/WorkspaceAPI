import { EmployeeData } from "./types";

const url = process.env.EMPLOYEE_API_URL;

export class EmployeeNotFoundError extends Error {
  constructor(employeeId: string) {
    super(`Employee ${employeeId} not found`);
    this.name = "EmployeeNotFoundError";
  }
}

/**
 * Fetches employee data from your organization's employee data API.
 *
 * IMPORTANT: this is an adapter. The URL, auth header, and response shape
 * below are placeholders — update them to match your real API. Everything
 * downstream only depends on the returned EmployeeData shape, so this is
 * the only function you should need to touch to plug in your real API.
 */
export async function fetchEmployeeData(
  employeeId: string,
): Promise<EmployeeData> {
  if (!url) {
    throw new Error(
      "EMPLOYEE_API_URL is not configured. Set it in .env.local to point at your employee data API.",
    );
  }

  const body = new URLSearchParams({
    userid: employeeId,
    password: GetPassword(),
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  if (res.status === 404) {
    throw new EmployeeNotFoundError(employeeId);
  }
  if (!res.ok) {
    throw new Error(
      `Employee API returned ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }

  const _raw = await res.json();
  const raw = _raw.Cargo[0] as EmployeeAllDetailsResponse;

  const [fullName] = raw.name.split("-");

  const parts = fullName.trim().split(/\s+/);

  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");

  const employee: EmployeeData = {
    employeeId,
    employeeType: raw.type || raw.employeeType || undefined,
    firstName,
    lastName,
    fullName,
    mobile: raw.mobileno?.toString().trim() || "",
    personalEmail: raw.C_EMAIL?.trim() || "",
    schoolId: raw.schid?.toString() || raw.SCHOOLID?.toString(),
    macId: raw.MAC || undefined,
  };

  if (!employee.firstName) {
    throw new Error(
      "Employee API response is missing expected name fields. Check the mapping in src/lib/employeeApi.ts.",
    );
  }

  return employee;
}

function GetPassword() {
  const date = Date.now();
  const year = new Date(date).getFullYear();
  const month = new Date(date).getMonth() + 1;
  const day = new Date(date).getDate();

  return `Mob#${year * day + month}37t@Zr`;
}

type EmployeeAllDetailsResponse = {
  APPOINT_ORDER_NO?: string | null;
  AadharNo?: string | null;
  appoint_date?: string | null;
  C_EMAIL?: string | null;
  category?: string | null;
  city?: string | null;
  CorAddress?: string | null;
  CurrSchJoining?: string | null;
  currpost?: string | null;
  currsch?: string | null;
  dob?: string | null;
  ex_ser_man?: string | null;
  G_NAME?: string | null;
  gender?: string | null;
  gradsub?: string | null;
  joining_date?: string | null;
  langknown?: string | null;
  m_status?: string | null;
  mobileno: number | null;
  name: string;
  employeeType?: string | null;
  type?: string | null;
  schid?: string | number | null;
  SCHOOLID?: string | number | null;
  MAC?: string | null;
  NearestSchool?: string | null;
  Other_PQualification?: string | null;
  pay_scale?: string | null;
  phy_disable?: string | null;
  postgradsub?: string | null;
  qualification?: string | null;
  RECRUITMENT?: string | null;
  SEL_NOM?: string | null;
  SEL_NOM_DATE?: string | null;
  StateAddress?: string | null;
  subtoteach?: string | null;
};
