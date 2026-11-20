import { createRequire } from "module";
import path from "path";

type QpdfModule = {
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
  callMain: (args: string[]) => number;
};

let modulePromise: Promise<QpdfModule> | null = null;

async function qpdfModule() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const imported = (await import("@neslinesli93/qpdf-wasm")) as unknown as {
        default: (options: { locateFile: () => string; noInitialRun: boolean }) => Promise<QpdfModule>;
      };
      const createModule = imported.default;
      const require = createRequire(path.join(process.cwd(), "package.json"));
      const wasmPath = require.resolve("@neslinesli93/qpdf-wasm/dist/qpdf.wasm");
      return createModule({ locateFile: () => wasmPath, noInitialRun: true });
    })();
  }
  return modulePromise;
}

export async function readablePdf(bytes: Uint8Array) {
  const { PDFDocument } = await import("pdf-lib");
  try {
    await PDFDocument.load(bytes);
    return bytes;
  } catch {
    // Official county forms are sometimes saved with an empty owner password.
  }
  const qpdf = await qpdfModule();
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const input = `/in-${stamp}.pdf`;
  const output = `/out-${stamp}.pdf`;
  qpdf.FS.writeFile(input, bytes);
  const code = qpdf.callMain(["--password=", "--decrypt", input, output]);
  try {
    if (code !== 0) {
      throw Object.assign(new Error("This form PDF is locked. Upload an unlocked copy of the official form."), { status: 400 });
    }
    return qpdf.FS.readFile(output);
  } finally {
    try { qpdf.FS.unlink(input); } catch { /* already gone */ }
    try { qpdf.FS.unlink(output); } catch { /* already gone */ }
  }
}
