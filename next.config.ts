import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Split deployment: when BACKEND_URL is set (Vercel frontend), proxy all API
  // traffic to the Railway backend. beforeFiles so it shadows the local routes.
  async rewrites() {
    const backend = process.env.BACKEND_URL?.replace(/\/$/, "");
    if (!backend) return { beforeFiles: [] };
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${backend}/api/:path*` },
      ],
    };
  },
};

export default nextConfig;
