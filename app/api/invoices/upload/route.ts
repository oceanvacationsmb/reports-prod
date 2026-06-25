import { NextRequest } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";

function configureCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw Object.assign(new Error("Cloudinary credentials are required for invoice uploads."), { status: 400 });
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    configureCloudinary();
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw Object.assign(new Error("Invoice file is required."), { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${file.type || "application/octet-stream"};base64,${bytes.toString("base64")}`;
    const upload = await cloudinary.uploader.upload(dataUri, {
      folder: "ocean-vacations/invoices",
      resource_type: file.type === "application/pdf" ? "raw" : "image",
      use_filename: true,
      unique_filename: true
    });

    return ok({ url: upload.secure_url, publicId: upload.public_id });
  } catch (error) {
    return fail(error);
  }
}
