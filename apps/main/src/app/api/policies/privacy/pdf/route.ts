import { NextResponse } from "next/server";
import { generatePolicyPdf } from "@/lib/policy-pdf";
import { PRIVACY_BODY, PRIVACY_LAST_UPDATED } from "@/lib/privacy-content";

export async function GET() {
  try {
    const pdfBytes = await generatePolicyPdf(
      "NORTHWEST COMMUNITY (NWC) – PRIVACY POLICY",
      PRIVACY_LAST_UPDATED,
      PRIVACY_BODY
    );
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="NWC-Privacy-Policy.pdf"',
      },
    });
  } catch (e) {
    console.error("[policies/privacy/pdf]", e);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
