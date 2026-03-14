import { NextResponse } from "next/server";
import { STORE_CATEGORIES } from "@/lib/store-categories";

export async function GET() {
  return NextResponse.json({ categories: STORE_CATEGORIES });
}
