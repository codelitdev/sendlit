import path from "node:path";
import { resetModules } from "@sendlit/test-utils";

const appRoot = path.resolve(import.meta.dir, "../..");

/** Evict apps/web's own modules so the next `import()` re-reads the environment. */
export function resetAppModules(): void {
  resetModules(appRoot, { keep: (modulePath) => modulePath === import.meta.path });
}
