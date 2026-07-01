/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/reports/pdf/*": ["./node_modules/@sparticuz/chromium/bin/**/*"]
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
