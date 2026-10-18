import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: "dist",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
