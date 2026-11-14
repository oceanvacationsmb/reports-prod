import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { TaxPacket } from "@/lib/models";
import { fail, ok } from "@/lib/http";
import { readPdfUpload } from "@/lib/uploads";

const kindSchema = z.enum(["st-3", "st-388", "st-3t", "st-389", "st-388-packet"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(req);
    const { id } = await params;
    const form = await req.formData();
    const kind = kindSchema.parse(String(form.get("kind") || "st-3"));
    const file = form.get("file");
    const bytes = await readPdfUpload(file instanceof File ? file : null);
    await connectDb();
    const packet = await TaxPacket.findById(id);
    if (!packet) throw Object.assign(new Error("Tax packet not found."), { status: 404 });
    if (packet.jurisdiction !== "georgetown") {
      throw Object.assign(new Error("The MyDORWAY return is stored on the Georgetown packet."), { status: 400 });
    }
    packet.stateReturns.push({
      kind,
      filename: file instanceof File ? file.name : `${kind}.pdf`,
      contentType: "application/pdf",
      data: bytes
    });
    await packet.save();
    return ok({
      stateReturns: packet.stateReturns.map((item: { kind?: string; filename?: string }, index: number) => ({
        index,
        kind: item.kind || "",
        filename: item.filename || "return.pdf"
      }))
    });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(req);
    const { id } = await params;
    const index = Number(req.nextUrl.searchParams.get("index") || 0);
    await connectDb();
    const packet = await TaxPacket.findById(id);
    const file = packet?.stateReturns?.[index];
    if (!file) return new Response("State return not found.", { status: 404 });
    return new Response(file.data, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${file.filename || "state-return.pdf"}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open the state return.";
    return new Response(message, { status: 500 });
  }
}
