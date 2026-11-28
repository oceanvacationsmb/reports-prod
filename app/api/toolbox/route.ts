import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { Setting } from "@/lib/models";

const key = "toolbox";
const tool = z.object({
  title: z.string().trim().min(1).max(120),
  url: z.string().trim().max(2048).url().refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Enter an HTTP or HTTPS URL.")
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const settings = await Setting.findOne({ key }).lean();
    return ok({ tools: settings?.value || [] });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    const entry = { ...tool.parse(await req.json()), id: randomUUID() };
    await connectDb();
    const settings = await Setting.findOneAndUpdate({ key }, { $push: { value: entry } }, { upsert: true, new: true }).lean();
    return ok({ tools: settings?.value || [] });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    assertAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(await req.json());
    await connectDb();
    const settings = await Setting.findOneAndUpdate({ key }, { $pull: { value: { id } } }, { new: true }).lean();
    return ok({ tools: settings?.value || [] });
  } catch (error) {
    return fail(error);
  }
}
