import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => ({
  treeshake: true,
  splitting: true,
  entry: ["src/**/*.tsx", "src/**/*.ts"],
  format: ["esm"],
  // `@sendlit/api-contract` is private and only used for types, so inline
  // them instead of leaving an import of an unpublished package.
  dts: { resolve: ["@sendlit/api-contract"] },
  minify: true,
  clean: true,
  external: ["react"],
  ...options,
}));
