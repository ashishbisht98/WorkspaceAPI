import nodemailer from "nodemailer";
import { googleAccountSignInUrl } from "./googleAdmin";

function getTransport() {
  const host = process.env.SMTP_HOST ?? "";
  const port = Number(process.env.SMTP_PORT ?? "0");
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP_HOST, SMTP_USER, SMTP_PASS must be set in .env.local to send notification emails.",
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function send(to: string, subject: string, html: string) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transport = getTransport();
  await transport.sendMail({ from, to, subject, html });
}

export async function sendAccountCreatedEmail(params: {
  personalEmail: string;
  fullName: string;
  workspaceEmail: string;
  tempPassword: string;
}) {
  const signInUrl = googleAccountSignInUrl(params.workspaceEmail);
  await send(
    params.personalEmail,
    "Your new Google Workspace account has been created",
    `
    <p>Dear ${params.fullName},</p>
    <p>A Google Workspace account has been created for you:</p>
    <ul>
      <li><b>Email:</b> ${params.workspaceEmail}</li>
      <li><b>Temporary password:</b> ${params.tempPassword}</li>
    </ul>
    <p>Please sign in and set a new password on first login:
      <a href="${signInUrl}">${signInUrl}</a>
    </p>
    <p>You will be required to change this password immediately after signing in.</p>
    <p>If you did not expect this account, please contact the IT administrator.</p>
    `,
  );
}

export async function sendAccountRenamedEmail(params: {
  personalEmail: string;
  fullName: string;
  oldEmail: string;
  newEmail: string;
  tempPassword: string;
}) {
  const signInUrl = googleAccountSignInUrl(params.newEmail);
  await send(
    params.personalEmail,
    "Your Google Workspace account email has changed",
    `
    <p>Dear ${params.fullName},</p>
    <p>Your Google Workspace account address has been updated to the standard format:</p>
    <ul>
      <li><b>Previous email:</b> ${params.oldEmail}</li>
      <li><b>New email:</b> ${params.newEmail}</li>
      <li><b>Temporary password:</b> ${params.tempPassword}</li>
    </ul>
    <p>Please sign in with your new email address and set a new password on first login:
      <a href="${signInUrl}">${signInUrl}</a>
    </p>
    <p>All your existing mail and files remain unchanged under the new address.</p>
    `,
  );
}

export async function sendPasswordResetEmail(params: {
  personalEmail: string;
  fullName: string;
  workspaceEmail: string;
  tempPassword: string;
}) {
  const signInUrl = googleAccountSignInUrl(params.workspaceEmail);
  await send(
    params.personalEmail,
    "Password reset for your Google Workspace account",
    `
    <p>Dear ${params.fullName},</p>
    <p>Your Google Workspace account details were updated, and a new temporary password has been set:</p>
    <ul>
      <li><b>Email:</b> ${params.workspaceEmail}</li>
      <li><b>Temporary password:</b> ${params.tempPassword}</li>
    </ul>
    <p>Please sign in and set a new password on first login:
      <a href="${signInUrl}">${signInUrl}</a>
    </p>
    `,
  );
}

export async function sendTabletDeregisteredEmail(params: {
  personalEmail: string;
  fullName: string;
}) {
  await send(
    params.personalEmail,
    "Device deregistration completed",
    `
    <p>Dear ${params.fullName || "Employee"},</p>
    <p>You ID has been deregistered from your device. Kindly register again to DOE DELHI App and then log in.</p>
    `,
  );
}

export async function sendGuestPasswordResetEmail(params: {
  personalEmail: string;
  fullName: string;
}) {
  await send(
    params.personalEmail,
    "Guest teacher password reset",
    `
    <p>Dear ${params.fullName || "Employee"},</p>
    <p>Your password has been reset to 'New'.</p>
    `,
  );
}
