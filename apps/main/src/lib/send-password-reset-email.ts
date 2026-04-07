import { Resend } from "resend";
import { getPublicSiteOrigin } from "@/lib/public-site-url";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendPasswordResetEmail(params: {
  to: string;
  resetToken: string;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[sendPasswordResetEmail] RESEND_API_KEY not configured, skipping email");
    return false;
  }
  try {
    const origin = getPublicSiteOrigin();
    const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(params.resetToken)}`;
    const appResetUrl = `inwcommunity://reset-password?token=${encodeURIComponent(params.resetToken)}`;
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Northwest Community <onboarding@resend.dev>",
      to: params.to,
      subject: "Reset your password — Northwest Community",
      html: `
        <p>Hi,</p>
        <p>We received a request to reset the password for your Northwest Community account.</p>
        <p><strong>On your phone (INW Community app):</strong> <a href="${appResetUrl}">Open the app to choose a new password</a></p>
        <p><strong>On the web:</strong> <a href="${resetUrl}">Choose a new password</a></p>
        <p>For security, you can only complete this kind of reset about once every 30 days. This link expires in one hour. If you didn&apos;t ask for this, you can ignore this email.</p>
        <p>— Northwest Community</p>
      `,
    });
    if (error) {
      console.error("[sendPasswordResetEmail]", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sendPasswordResetEmail]", e);
    return false;
  }
}
