/**
 * HTML for the three transactional emails email authentication sends.
 *
 * Written for mail clients rather than browsers, which is why they look dated:
 * a table for layout, inline styles on every element, no external stylesheet
 * and no web font. Outlook renders a `<div>` grid as a single column and drops
 * a `<style>` block entirely; a table with inline styles is the one thing that
 * survives everywhere.
 *
 * Every value that reaches the markup is escaped. A school name is chosen by an
 * administrator and a recipient name comes from an invite form — neither is
 * markup, and treating them as such would put an injection point inside a
 * message this platform signs.
 */

export interface EmailTemplate {
  subject: string;
  html: string;
}

/** HTML-escapes untrusted text before it is interpolated into a template. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes a URL for an `href`.
 *
 * The scheme is checked as well as the characters: a `javascript:` link in an
 * email is inert in most clients but live in a webmail preview pane, and this
 * function is the only place a URL enters the markup.
 */
function escapeUrl(value: string): string {
  const trimmed = value.trim();
  const safe = /^https?:\/\//i.test(trimmed) ? trimmed : '#';
  return escapeHtml(safe);
}

const BRAND_COLOR = '#0f172a';
const ACCENT_COLOR = '#1d4ed8';
const MUTED_COLOR = '#64748b';
const BORDER_COLOR = '#e2e8f0';

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * The frame every message shares: school name in the header, content in the
 * middle, security note and a "you can ignore this" line at the bottom.
 *
 * `max-width: 560px` plus `width: 100%` is what makes these readable on a
 * phone — media queries are unreliable in mail clients, so the layout has to be
 * fluid rather than responsive.
 */
function layout(params: {
  schoolName: string;
  preheader: string;
  body: string;
  securityNote: string;
}): string {
  const school = escapeHtml(params.schoolName);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${school}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:${FONT_STACK};">
    <!-- Preheader: the grey line clients show beside the subject. Hidden in the body. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${escapeHtml(params.preheader)}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid ${BORDER_COLOR};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:${BRAND_COLOR};padding:24px 32px;">
                <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;letter-spacing:0.01em;">
                  ${school}
                </h1>
              </td>
            </tr>

            <tr>
              <td style="padding:32px;color:#0f172a;font-size:15px;line-height:1.6;">
                ${params.body}
              </td>
            </tr>

            <tr>
              <td style="padding:20px 32px;background-color:#f8fafc;border-top:1px solid ${BORDER_COLOR};color:${MUTED_COLOR};font-size:12px;line-height:1.6;">
                <strong style="color:#0f172a;">Security notice.</strong>
                ${escapeHtml(params.securityNote)}
                Nobody from ${school} will ever ask you for this code.
              </td>
            </tr>
          </table>

          <p style="max-width:560px;margin:16px auto 0;color:${MUTED_COLOR};font-size:11px;line-height:1.6;text-align:center;">
            This message was sent automatically by ${school}. Please do not reply to it.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * The code itself, in the largest type in the message.
 *
 * Letter-spacing is what makes a six-digit code readable at a glance and
 * transcribable without a second look — the one piece of typography here that
 * is doing real work.
 */
function otpBlock(otp: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr>
      <td align="center" style="background-color:#f8fafc;border:1px solid ${BORDER_COLOR};border-radius:10px;padding:20px 12px;">
        <div style="color:${MUTED_COLOR};font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">
          Your verification code
        </div>
        <div style="color:${BRAND_COLOR};font-size:34px;font-weight:700;letter-spacing:0.22em;font-family:${FONT_STACK};">
          ${escapeHtml(otp)}
        </div>
      </td>
    </tr>
  </table>`;
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr>
      <td align="center" style="background-color:${ACCENT_COLOR};border-radius:8px;">
        <a href="${escapeUrl(url)}"
           style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

export interface InvitationEmailParams {
  schoolName: string;
  recipientName: string;
  role: string;
  /** Absolute URL carrying the token, the email and the school. */
  verifyUrl: string;
  otp: string;
  expiryHours: number;
}

export function invitationEmailTemplate(params: InvitationEmailParams): EmailTemplate {
  const school = escapeHtml(params.schoolName);
  const name = escapeHtml(params.recipientName);
  const role = escapeHtml(params.role);
  const hours = Math.max(1, Math.round(params.expiryHours));

  const body = `
    <p style="margin:0 0 16px;">Hello ${name},</p>

    <p style="margin:0 0 16px;">
      You have been invited to join <strong>${school}</strong> as
      <strong>${role}</strong>. To finish setting up your account, open the link
      below and enter the verification code shown here.
    </p>

    ${button('Set up my account', params.verifyUrl)}

    ${otpBlock(params.otp)}

    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:13px;">
      This invitation expires in ${hours} hours. If the button does not work,
      copy this address into your browser:<br />
      <span style="word-break:break-all;color:${ACCENT_COLOR};">${escapeHtml(params.verifyUrl)}</span>
    </p>`;

  return {
    subject: `You have been invited to ${params.schoolName}`,
    html: layout({
      schoolName: params.schoolName,
      preheader: `Set up your ${params.schoolName} account — code ${params.otp}`,
      body,
      securityNote:
        'If you were not expecting this invitation, you can ignore this email and no account will be created.',
    }),
  };
}

export interface ForgotPasswordEmailParams {
  schoolName: string;
  recipientName: string;
  otp: string;
  expiryMinutes: number;
}

export function forgotPasswordEmailTemplate(
  params: ForgotPasswordEmailParams,
): EmailTemplate {
  const name = escapeHtml(params.recipientName);
  const minutes = Math.max(1, Math.round(params.expiryMinutes));

  const body = `
    <p style="margin:0 0 16px;">Hello ${name},</p>

    <p style="margin:0 0 16px;">
      We received a request to reset the password on your
      <strong>${escapeHtml(params.schoolName)}</strong> account. Enter the code
      below on the reset page to choose a new one.
    </p>

    ${otpBlock(params.otp)}

    <p style="margin:0;color:${MUTED_COLOR};font-size:13px;">
      This code expires in ${minutes} minutes and can be used once.
    </p>`;

  return {
    subject: `Reset your ${params.schoolName} password`,
    html: layout({
      schoolName: params.schoolName,
      preheader: `Password reset code ${params.otp}`,
      body,
      securityNote:
        'If you did not ask to reset your password, ignore this email — your current password still works and nothing has changed.',
    }),
  };
}

export interface OtpLoginEmailParams {
  schoolName: string;
  otp: string;
  expiryMinutes: number;
}

export function otpLoginEmailTemplate(params: OtpLoginEmailParams): EmailTemplate {
  const minutes = Math.max(1, Math.round(params.expiryMinutes));

  const body = `
    <p style="margin:0 0 16px;">
      Here is your sign-in code for
      <strong>${escapeHtml(params.schoolName)}</strong>.
    </p>

    ${otpBlock(params.otp)}

    <p style="margin:0;color:${MUTED_COLOR};font-size:13px;">
      This code expires in ${minutes} minutes and can be used once.
    </p>`;

  return {
    subject: `Your ${params.schoolName} sign-in code`,
    html: layout({
      schoolName: params.schoolName,
      preheader: `Sign-in code ${params.otp}`,
      body,
      securityNote:
        'If you did not try to sign in, ignore this email and consider changing your password.',
    }),
  };
}
