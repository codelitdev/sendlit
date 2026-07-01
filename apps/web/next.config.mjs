/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    transpilePackages: ["@sendlit/email-editor", "@sendlit/email-blocks"],
};

export default nextConfig;
