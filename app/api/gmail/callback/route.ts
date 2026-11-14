import { NextRequest } from "next/server";
import { connectCallback } from "@/lib/statements/gmail-oauth";

export async function GET(req: NextRequest) {
  return connectCallback(req);
}
