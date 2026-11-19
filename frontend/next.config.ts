import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN devices to load dev assets when browsing via this machine's IP.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
