import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const PLAN_NAMES: Record<string, string> = {
  subscribe: "Northwest Community Resident",
  sponsor: "Northwest Community Business",
  seller: "Northwest Community Seller",
};

export async function sendRenewalReminderEmail(params: {
  to: string;
  memberName: string | null;
  plan: string;
  amountCents: number;
  periodEnd: Date;
  billingInterval: "month" | "year";
}): Promise<boolean> {
  if (!resend) {
    console.warn("[sendRenewalReminderEmail] RESEND_API_KEY not configured, skipping email");
    return false;
  }
  try {
    const { to, memberName, plan, amountCents, periodEnd, billingInterval } = params;
    const planName = PLAN_NAMES[plan] ?? plan;
    const amount = (amountCents / 100).toFixed(2);
    const periodLabel = billingInterval === "year" ? "year" : "month";
    const baseUrl =
      process.env.NEXTAUTH_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://inwcommunity.com");
    const manageUrl = `${baseUrl}/my-community/subscriptions`;

    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Northwest Community <onboarding@resend.dev>",
      to,
      subject: `Your ${planName} subscription renews in 2 days`,
      html: `
        <p>Hi ${memberName ?? "there"},</p>
        <p>This is a reminder that your <strong>${planName}</strong> subscription will renew in 2 days (${periodEnd.toLocaleDateString()}).</p>
        <p><strong>Renewal terms:</strong></p>
        <ul>
          <li>You will be charged <strong>$${amount}</strong> per ${periodLabel} until you cancel.</li>
          <li>You can cancel anytime before renewal to avoid the next charge.</li>
          <li>After cancellation, you keep access until the end of your current billing period.</li>
        </ul>
        <p><a href="${manageUrl}">Manage subscription &amp; cancel</a></p>
        <p>— Northwest Community</p>
      `,
    });
    if (error) {
      console.error("[sendRenewalReminderEmail]", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sendRenewalReminderEmail]", e);
    return false;
  }
}
