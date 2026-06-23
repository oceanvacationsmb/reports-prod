/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["mongoose", "bcryptjs", "jsonwebtoken", "cloudinary"]
};

export default nextConfig;
