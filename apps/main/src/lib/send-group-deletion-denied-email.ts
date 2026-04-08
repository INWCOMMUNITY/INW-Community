import { Resend } from "resend";
import { getPublicSiteOrigin } from "@/lib/public-site-url";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const MAX_REASON_LEN = 4000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendGroupDeletionRequestDeniedEmail(params: {
  to: string;
  groupName: string;
  reason: string;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[sendGroupDeletionRequestDeniedEmail] RESEND_API_KEY not configured, skipping email");
    return false;
  }
  const origin = getPublicSiteOrigin();
  const termsUrl = `${origin}/terms`;
  const privacyUrl = `${origin}/privacy`;
  const safeName = escapeHtml(params.groupName.slice(0, 200));
  const safeReason = escapeHtml(params.reason.slice(0, MAX_REASON_LEN)).replace(/\n/g, "<br/>");

  try {
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Northwest Community <onboarding@resend.dev>",
      to: params.to,
      subject: "Your group deletion request was not approved",
      html: `
        <p>Hello,</p>
        <p>We reviewed your request to delete the community group <strong>${safeName}</strong>. We are not able to approve that request at this time.</p>
        <p><strong>Reason:</strong></p>
        <p style="white-space:pre-wrap;border-left:3px solid #ccc;padding-left:12px;margin:12px 0;">${safeReason}</p>
        <p>Your group remains active. Our <a href="${termsUrl}">Terms of Service</a> and <a href="${privacyUrl}">Privacy Policy</a> describe how we operate the platform. If you have questions, reply to this email or contact us through the website.</p>
        <p>— Northwest Community</p>
      `,
    });
    if (error) {
      console.error("[sendGroupDeletionRequestDeniedEmail]", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sendGroupDeletionRequestDeniedEmail]", e);
    return false;
  }
}
