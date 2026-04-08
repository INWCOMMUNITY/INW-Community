import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendVerificationEmail(params: { to: string; code: string }): Promise<boolean> {
  if (!resend) {
    const logCodeInDev =
      process.env.NODE_ENV === "development" || process.env.VERIFICATION_EMAIL_LOG_CODE === "1";
    if (logCodeInDev) {
      console.warn(
        `[sendVerificationEmail] No RESEND_API_KEY — verification code for ${params.to}: ${params.code}`,
      );
      return true;
    }
    console.warn("[sendVerificationEmail] RESEND_API_KEY not configured, skipping email");
    return false;
  }
  try {
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Northwest Community <onboarding@resend.dev>",
      to: params.to,
      subject: "Your Northwest Community verification code",
      html: `
        <p>Hi,</p>
        <p>Thanks for signing up. Use this code to verify your email and finish creating your account:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:0.2em;font-family:ui-monospace,monospace;">${params.code}</p>
        <p>This code expires in 30 minutes. If you didn&apos;t create an account, you can ignore this message.</p>
        <p>— Northwest Community</p>
      `,
    });
    if (error) {
      console.error("[sendVerificationEmail]", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sendVerificationEmail]", e);
    return false;
  }
}
