export async function readPdfUpload(file: File | null, maxBytes = 8_000_000) {
  if (!file || file.size <= 0) throw Object.assign(new Error("Choose a PDF."), { status: 400 });
  if (file.size > maxBytes) throw Object.assign(new Error("That PDF is larger than 8 MB."), { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.subarray(0, 5).toString("utf8").startsWith("%PDF")) {
    throw Object.assign(new Error("Upload a PDF file."), { status: 400 });
  }
  return bytes;
}
