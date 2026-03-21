import { NextResponse } from "next/server";
import { BUSINESS_CATEGORIES } from "@/lib/business-categories";

export async function GET() {
  return NextResponse.json({ categories: BUSINESS_CATEGORIES });
}
