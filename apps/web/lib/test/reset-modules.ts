import path from "node:path";
import { resetModules } from "@sendlit/test-utils";

const appRoot = path.resolve(import.meta.dir, "../..");

/** Evict apps/web's own modules, and the observability package's browser
 * module (it keeps the PostHog client in module state), so the next
 * `import()` starts fresh. */
export function resetAppModules(): void {
  resetModules(appRoot, { keep: (modulePath) => modulePath === import.meta.path });
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/@codelitdev/observability/")) delete require.cache[key];
  }
}
