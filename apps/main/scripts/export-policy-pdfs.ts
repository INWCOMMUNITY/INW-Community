/**
 * One-off script to export Terms and Privacy Policy as PDFs.
 * Run: npx tsx scripts/export-policy-pdfs.ts
 */
import * as fs from "fs";
import * as path from "path";
import { generatePolicyPdf } from "../src/lib/policy-pdf";
import { TERMS_BODY, TERMS_LAST_UPDATED } from "../src/lib/terms-content";
import { PRIVACY_BODY, PRIVACY_LAST_UPDATED } from "../src/lib/privacy-content";

async function main() {
  const outDir = path.join(process.cwd(), "policy-pdfs");
  fs.mkdirSync(outDir, { recursive: true });

  const termsPdf = await generatePolicyPdf(
    "NORTHWEST COMMUNITY (NWC) – TERMS OF SERVICE",
    TERMS_LAST_UPDATED,
    TERMS_BODY
  );
  fs.writeFileSync(path.join(outDir, "NWC-Terms-of-Service.pdf"), termsPdf);
  console.log("Saved: policy-pdfs/NWC-Terms-of-Service.pdf");

  const privacyPdf = await generatePolicyPdf(
    "NORTHWEST COMMUNITY (NWC) – PRIVACY POLICY",
    PRIVACY_LAST_UPDATED,
    PRIVACY_BODY
  );
  fs.writeFileSync(path.join(outDir, "NWC-Privacy-Policy.pdf"), privacyPdf);
  console.log("Saved: policy-pdfs/NWC-Privacy-Policy.pdf");
}

main().catch(console.error);
