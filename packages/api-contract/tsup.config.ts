import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
    treeshake: true,
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    minify: false,
    clean: true,
    ...options,
}));
