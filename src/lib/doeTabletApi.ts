const DEFAULT_TABLET_GET_ENDPOINT =
  "https://edustud.nic.in/MOBAPPSERVICE/EDUWEBSERVICE/WEBAPPSMOB.ASMX/get";
const DEFAULT_TABLET_POST_ENDPOINT =
  "https://edustud.nic.in/MOBAPPSERVICE/EDUWEBSERVICE/WEBAPPSMOB.ASMX/post";

const tabletGetEndpoint =
  process.env.DOE_TABLET_GET_API_URL ||
  process.env.DOE_TABLET_API_URL ||
  DEFAULT_TABLET_GET_ENDPOINT;

const tabletPostEndpoint =
  process.env.DOE_TABLET_POST_API_URL ||
  process.env.DOE_TABLET_API_URL ||
  DEFAULT_TABLET_POST_ENDPOINT;

export type TabletRegistrationDetails = {
  employeeId?: string;
  employeeType: string;
  name?: string;
  mobile?: string;
  email?: string;
  schoolId?: string;
  registeredDeviceId?: string;
};

const TABLET_EMPLOYEE_TYPE_CANDIDATES = [
  "government",
  "guest",
  "Government",
  "GOVERNMENT",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "0",
  "Guest",
  "GUEST",
  "GT",
  "G",
  "Regular",
  "REGULAR",
];

const DEVICE_ID_KEYS = [
  "DEVICEID",
  "DeviceID",
  "deviceID",
  "device_id",
  "DEVICE_NO",
  "DeviceNo",
  "deviceno",
  "TABID",
  "TabId",
  "tabId",
  "ID",
  "id",
  "MAC",
  "Mac",
  "mac",
  "DeviceId",
  "deviceId",
  "deviceid",
  "DEVICE_ID",
  "Device_ID",
];

export function isValidTabletEmployeeId(employeeId: string) {
  return /^\d{8,10}$/.test(employeeId);
}

export function tabletEmployeeTypeForId(employeeId: string) {
  return employeeId.length === 8 ? "government" : "guest";
}

export function convertEmployeeIdToMac(employeeId: string) {
  return employeeId
    .padStart(12, "0")
    .slice(-12)
    .match(/.{1,2}/g)
    ?.join(":") || employeeId;
}

export async function callDoeTabletApi(
  proc: string,
  operation: "get" | "post" = "post",
) {
  const endpoint = operation === "get" ? tabletGetEndpoint : tabletPostEndpoint;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
    },
    body: new URLSearchParams({
      proc,
      password: getPassword(),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `DOE tablet ${operation} API returned ${res.status}: ${await res
        .text()
        .catch(() => "")}`,
    );
  }

  const text = await res.text();
  const data = parseDoeResponse(text);
  return data.data?.Cargo ?? data.Cargo;
}

export async function fetchTabletRegistrationDetails(
  employeeId: string,
  employeeType: string,
): Promise<TabletRegistrationDetails | null> {
  const cargo = await callDoeTabletApi(
    `usp_checkshift ${employeeId},${employeeType}`,
    "get",
  );

  if (typeof cargo === "string" || !Array.isArray(cargo) || cargo.length === 0) {
    return null;
  }

  return mapTabletRegistrationRow(employeeType, cargo[0]);
}

export async function fetchTabletRegistrationDetailsByDeviceId(
  deviceId: string,
): Promise<TabletRegistrationDetails | null> {
  const cargo = await callDoeTabletApi(
    `uspfindRegistrationFormdetails '${deviceId}'`,
    "get",
  );

  if (typeof cargo === "string" || !Array.isArray(cargo) || cargo.length === 0) {
    return null;
  }

  const row = cargo[0] as Record<string, unknown>;
  return {
    employeeId: firstTextValue(row, ["EMPID", "employeeId", "EmployeeId"]),
    employeeType: firstTextValue(row, ["type", "TYPE", "employeeType"]) || "",
    name: firstTextValue(row, ["EMAIL", "Email", "name", "Name"]),
    mobile: firstTextValue(row, ["mob", "MOB", "mobile", "Mobile"]),
    email: firstTextValue(row, ["C_EMAIL", "EMAIL", "Email", "email"]),
    schoolId: firstTextValue(row, ["SCHOOLID", "SchoolId", "schoolId", "schid"]),
    registeredDeviceId: firstTextValue(row, DEVICE_ID_KEYS) || deviceId,
  };
}

export async function fetchTabletRegistrationDetailsForEmployee(
  employeeId: string,
  preferredEmployeeTypes: string[] = [],
  onAttempt?: (message: string) => void,
): Promise<TabletRegistrationDetails | null> {
  const employeeTypes = [
    ...preferredEmployeeTypes,
    tabletEmployeeTypeForId(employeeId),
    ...TABLET_EMPLOYEE_TYPE_CANDIDATES,
  ].filter((value, index, all) => value.trim() && all.indexOf(value) === index);

  for (const employeeType of employeeTypes) {
    const cargo = await callDoeTabletApi(
      `usp_checkshift ${employeeId},${employeeType}`,
      "get",
    );
    onAttempt?.(`usp_checkshift ${employeeId},${employeeType}: ${summarizeCargo(cargo)}`);

    if (typeof cargo === "string" || !Array.isArray(cargo) || cargo.length === 0) {
      continue;
    }

    const registration = mapTabletRegistrationRow(employeeType, cargo[0]);
    if (registration) return registration;
  }

  return null;
}

function mapTabletRegistrationRow(
  employeeType: string,
  rowValue: unknown,
): TabletRegistrationDetails | null {
  if (!rowValue || typeof rowValue !== "object") return null;

  const row = rowValue as Record<string, unknown>;

  return {
    employeeType,
    name: firstTextValue(row, ["Empname", "EMPNAME", "name", "Name"]),
    mobile: firstTextValue(row, ["mob", "MOB", "mobile", "Mobile"]),
    email: firstTextValue(row, ["C_EMAIL", "EMAIL", "Email", "email"]),
    schoolId: firstTextValue(row, ["schid", "SCHOOLID", "SchoolId", "schoolId"]),
    registeredDeviceId: firstTextValue(row, DEVICE_ID_KEYS),
  };
}

function firstTextValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      const clean = value.trim();
      if (clean) return clean;
    }
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function summarizeCargo(cargo: unknown) {
  if (typeof cargo === "string") return `string "${cargo.slice(0, 120)}"`;
  if (Array.isArray(cargo)) {
    if (cargo.length === 0) return "empty array";
    const firstRow = cargo[0];
    if (firstRow && typeof firstRow === "object") {
      const row = firstRow as Record<string, unknown>;
      const keys = Object.keys(row).join(", ");
      const deviceId = firstTextValue(row, DEVICE_ID_KEYS);
      return `array(${cargo.length}), keys: ${keys || "none"}${
        deviceId ? `, device: ${deviceId}` : ""
      }`;
    }
    return `array(${cargo.length})`;
  }
  return cargo == null ? "empty response" : `type ${typeof cargo}`;
}

function parseDoeResponse(text: string): { Cargo?: unknown; data?: { Cargo?: unknown } } {
  const cleanText = text.trim();

  try {
    return normalizeDoePayload(JSON.parse(cleanText));
  } catch {
    const xmlStringValue = extractXmlString(cleanText);
    if (xmlStringValue) {
      try {
        return normalizeDoePayload(JSON.parse(xmlStringValue));
      } catch {
        return { Cargo: xmlStringValue };
      }
    }

    throw new Error(`DOE tablet API returned an unexpected response: ${cleanText.slice(0, 500)}`);
  }
}

function normalizeDoePayload(payload: unknown): { Cargo?: unknown; data?: { Cargo?: unknown } } {
  if (payload && typeof payload === "object" && "d" in payload) {
    const dValue = (payload as { d?: unknown }).d;
    if (typeof dValue === "string") {
      try {
        return normalizeDoePayload(JSON.parse(dValue));
      } catch {
        return { Cargo: dValue };
      }
    }
  }

  return payload as { Cargo?: unknown; data?: { Cargo?: unknown } };
}

function extractXmlString(text: string) {
  const match = text.match(/<string[^>]*>([\s\S]*?)<\/string>/i);
  if (!match) return undefined;

  return decodeXmlEntities(match[1].trim());
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function getPassword() {
  const date = Date.now();
  const year = new Date(date).getFullYear();
  const month = new Date(date).getMonth() + 1;
  const day = new Date(date).getDate();

  return `Mob#${year * day + month}37t@Zr`;
}
