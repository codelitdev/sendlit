import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => ({
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    target: "node18",
    platform: "node",
    // `@sendlit/api-contract` is a private workspace package, so its routes
    // and Zod schemas are bundled into the SDK (code and types) instead of
    // being a runtime dependency. Its own deps stay external.
    noExternal: ["@sendlit/api-contract"],
    dts: { resolve: ["@sendlit/api-contract"] },
    treeshake: true,
    minify: false,
    clean: true,
    ...options,
}));
