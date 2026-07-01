/** @type {import('next').NextConfig} */
const nextConfig = {
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
