/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  env: {
    ITEMS_PER_PAGE: process.env.ITEMS_PER_PAGE || "10",
  },
  transpilePackages: [
    "@sendlit/api-contract",
    "@sendlit/email-editor",
    "@sendlit/email-blocks",
    "@codelitdev/design-system",
  ],
};

export default nextConfig;
