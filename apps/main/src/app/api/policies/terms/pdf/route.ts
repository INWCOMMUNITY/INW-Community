import { NextResponse } from "next/server";
import { generatePolicyPdf } from "@/lib/policy-pdf";
import { TERMS_BODY, TERMS_LAST_UPDATED } from "@/lib/terms-content";

export async function GET() {
  try {
    const pdfBytes = await generatePolicyPdf(
      "NORTHWEST COMMUNITY (NWC) – TERMS OF SERVICE",
      TERMS_LAST_UPDATED,
      TERMS_BODY
    );
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="NWC-Terms-of-Service.pdf"',
      },
    });
  } catch (e) {
    console.error("[policies/terms/pdf]", e);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
