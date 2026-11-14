import { NextRequest } from "next/server";
import { GET as status, POST as start } from "@/lib/statements/gmail-oauth";

export async function GET(req: NextRequest) {
  return status(req);
}

export async function POST(req: NextRequest) {
  return start(req);
}
