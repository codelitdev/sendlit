/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    transpilePackages: [
        "@sendlit/email-editor",
        "@sendlit/email-blocks",
        "@codelitdev/design-system",
    ],
};

export default nextConfig;
