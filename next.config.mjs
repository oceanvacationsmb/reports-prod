/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/reports/pdf/*": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/tax-forms/pdf": ["./node_modules/@neslinesli93/qpdf-wasm/dist/**/*"],
    "/api/tax-jurisdictions/*/template": ["./node_modules/@neslinesli93/qpdf-wasm/dist/**/*"]
  },
  serverExternalPackages: [
    "mongoose",
    "bcryptjs",
    "jsonwebtoken",
    "cloudinary",
    "@sparticuz/chromium",
    "puppeteer-core",
    "@neslinesli93/qpdf-wasm",
    "pdf-lib"
  ]
};

export default nextConfig;
