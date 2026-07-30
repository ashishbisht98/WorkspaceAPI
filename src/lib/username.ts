const DOMAIN = process.env.WORKSPACE_DOMAIN || "doe.delhi.gov.in";

/** Strip anything that isn't a-z0-9, lowercase it. */
function sanitizeNamePart(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Builds the canonical new-format username: employeeid.firstname@doe.delhi.gov.in */
export function buildExpectedUsername(employeeId: string, firstName: string): string {
  const cleanId = employeeId.trim();
  const cleanFirst = sanitizeNamePart(firstName);
  return `${cleanId}.${cleanFirst}@${DOMAIN}`;
}

export function getDomain(): string {
  return DOMAIN;
}

/** True if the given primary email exactly matches the expected new format. */
export function isNewFormat(primaryEmail: string, employeeId: string, firstName: string): boolean {
  return primaryEmail.toLowerCase() === buildExpectedUsername(employeeId, firstName).toLowerCase();
}

/** True if the email's local part starts with "employeeid." (i.e. belongs to this employee in some form). */
export function belongsToEmployeeId(primaryEmail: string, employeeId: string): boolean {
  const local = primaryEmail.split("@")[0] || "";
  return local === employeeId || local.startsWith(`${employeeId}.`);
}

export function isValidEmployeeId(employeeId: string): boolean {
  return /^\d{8}$/.test(employeeId);
}

/** Generates a random, Workspace-policy-friendly temporary password. */
export function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%^&*";
  const all = upper + lower + digits + special;

  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];

  const pwd = [pick(upper), pick(lower), pick(digits), pick(special)];
  for (let i = 0; i < 8; i++) pwd.push(pick(all));
  // shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join("");
}
