import { NextResponse } from "next/server";

/**
 * Stub for legacy or external POSTs to /customer/address_file/upload.
 * This path is not used by the app; return 404 so callers get a clear response
 * instead of "Failed to find Server Action".
 */
export async function POST() {
  return NextResponse.json(
    { error: "Not found", message: "This endpoint does not exist." },
    { status: 404 }
  );
}

export async function GET() {
  return NextResponse.json(
    { error: "Not found", message: "This endpoint does not exist." },
    { status: 404 }
  );
}
