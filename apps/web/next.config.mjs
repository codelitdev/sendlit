/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    env: {
        ITEMS_PER_PAGE: process.env.ITEMS_PER_PAGE || "10",
    },
    transpilePackages: [
        "@sendlit/email-editor",
        "@sendlit/email-blocks",
        "@codelitdev/design-system",
    ],
};

export default nextConfig;
