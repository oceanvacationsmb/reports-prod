/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/reports/pdf/*": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/statements/batch/output": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/tax/packets/[id]/pdf": ["./assets/tax-forms/**/*"]
  },
  serverExternalPackages: [
    "mongoose",
    "bcryptjs",
    "jsonwebtoken",
    "cloudinary",
    "@sparticuz/chromium",
    "puppeteer-core"
  ]
};

export default nextConfig;
