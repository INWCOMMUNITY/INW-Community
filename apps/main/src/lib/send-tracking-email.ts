import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendTrackingEmail(params: {
  to: string;
  buyerName: string;
  orderId: string;
  carrier: string;
  service: string;
  trackingNumber: string;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[sendTrackingEmail] RESEND_API_KEY not configured, skipping email");
    return false;
  }
  try {
    const { to, buyerName, orderId, carrier, service, trackingNumber } = params;
    const trackingUrl =
      carrier === "USPS"
        ? `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`
        : carrier === "UPS"
        ? `https://www.ups.com/track?tracknum=${trackingNumber}`
        : carrier === "FedEx"
        ? `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`
        : `https://www.google.com/search?q=track+${trackingNumber}`;

    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Northwest Community <onboarding@resend.dev>",
      to,
      subject: `Your order has shipped - Tracking #${trackingNumber}`,
      html: `
        <p>Hi ${buyerName},</p>
        <p>Your order #${orderId.slice(-8).toUpperCase()} has shipped!</p>
        <p><strong>Carrier:</strong> ${carrier} ${service}</p>
        <p><strong>Tracking number:</strong> ${trackingNumber}</p>
        <p><a href="${trackingUrl}">Track your package</a></p>
      `,
    });
    if (error) {
      console.error("[sendTrackingEmail]", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sendTrackingEmail]", e);
    return false;
  }
}
