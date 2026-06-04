import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow loading dev resources (/_next/*, HMR) when the dev server is reached
  // from a LAN IP (e.g. testing on a phone via http://<lan-ip>:3000). Without
  // this, Next 16 blocks cross-origin dev requests and the page never hydrates.
  // Dev-only setting; has no effect on production builds.
  allowedDevOrigins: ["192.168.1.11"],
};

export default nextConfig;
