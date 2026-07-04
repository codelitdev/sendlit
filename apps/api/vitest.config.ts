import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
        setupFiles: ["src/test/setup.ts"],
        // Each file boots its own in-memory PGlite instance (see src/test/db.ts);
        // WASM postgres startup is the dominant cost, so keep files parallel but
        // tests within a file sequential (they share that instance).
        fileParallelism: true,
        testTimeout: 20000,
        hookTimeout: 20000,
    },
});
