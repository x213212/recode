/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Build a replacement bundle beside the currently running `.next` tree.
  // This keeps the live site's chunks stable until the final atomic swap.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  outputFileTracingExcludes: {
    "*": [".local/**/*"]
  }
};

export default nextConfig;
