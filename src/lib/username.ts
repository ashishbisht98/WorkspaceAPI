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

/** True if the given primary email matches the expected new-format pattern for the employee. */
export function isNewFormat(primaryEmail: string, employeeId: string, firstName: string): boolean {
  const cleanEmail = primaryEmail.trim().toLowerCase();
  const cleanId = employeeId.trim().toLowerCase();

  if (!cleanEmail || !cleanId) return false;

  if (firstName) {
    return cleanEmail === buildExpectedUsername(employeeId, firstName).toLowerCase();
  }

  const [localPart] = cleanEmail.split("@");
  if (!localPart) return false;

  const prefix = `${cleanId}.`;
  if (!localPart.startsWith(prefix)) return false;

  const suffix = localPart.slice(prefix.length);
  return suffix.length > 0 && !suffix.includes(".");
}

/** True if the email's local part starts with "employeeid." (i.e. belongs to this employee in some form). */
export function belongsToEmployeeId(primaryEmail: string, employeeId: string): boolean {
  const local = primaryEmail.split("@")[0] || "";
  return local === employeeId || local.startsWith(`${employeeId}.`);
}

export function isValidEmployeeId(employeeId: string): boolean {
  return /^\d{8}$/.test(employeeId);
}

/**
 * True if `email` is a plausible personal email address. Employees often
 * mistype their Gmail address (abc@gmaail.com, abc@gmail.co, abc@gmai) — if
 * the domain contains a "g" it's almost certainly meant to be Gmail, so
 * require it to match gmail.com exactly rather than accepting near-misses.
 */
export function isValidPersonalEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;

  const domain = trimmed.slice(trimmed.indexOf("@") + 1).toLowerCase();
  if (domain.includes("g") && domain !== "gmail.com") return false;

  return true;
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
