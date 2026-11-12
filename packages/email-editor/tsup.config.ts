import { copyFile } from "node:fs/promises";
import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => ({
  treeshake: true,
  splitting: true,
  entry: ["src/**/*.tsx", "src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.test.tsx"],
  format: ["esm"],
  dts: true,
  minify: true,
  clean: true,
  external: ["react"],
  // The editor's own stylesheet, on its own, for apps that build Tailwind
  // themselves: `styles.css` also carries a full Tailwind build and theme.
  onSuccess: async () => {
    await copyFile("src/editor.css", "dist/editor.css");
  },
  ...options,
}));
