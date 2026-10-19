// Bun's `bun:test` covers most of the Vitest API SendLit used. These fill the
// gaps (`vi.stubEnv`, `vi.stubGlobal`, `vi.waitFor` and their resets) with the
// same semantics: stubs last until the matching `unstubAll*` call, which test
// files make in `afterEach`.

const originalEnv = new Map<string, string | undefined>();
const originalGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

/** Set (or with `undefined`, delete) an environment variable until `unstubAllEnvs()`. */
export function stubEnv(name: string, value: string | undefined): void {
  if (!originalEnv.has(name)) originalEnv.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export function unstubAllEnvs(): void {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  originalEnv.clear();
}

/** Replace a global (for example `fetch`) until `unstubAllGlobals()`. */
export function stubGlobal(name: PropertyKey, value: unknown): void {
  if (!originalGlobals.has(name)) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export function unstubAllGlobals(): void {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<PropertyKey, unknown>)[name];
  }
  originalGlobals.clear();
}

/** Retry `callback` until it stops throwing (or its promise resolves), like `vi.waitFor`. */
export async function waitFor<T>(
  callback: () => T | Promise<T>,
  options: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const timeout = options.timeout ?? 1000;
  const interval = options.interval ?? 50;
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await callback();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

/**
 * Bun stand-in for `vi.resetModules()`: evict source modules under `root` from
 * the module registry so the next `import()` re-evaluates them (and what they
 * import) against the current environment and mocks. Dependencies under
 * `node_modules`, test files, and paths matched by `keep` stay cached.
 */
export function resetModules(
  root: string,
  options: { keep?: (modulePath: string) => boolean } = {},
): void {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  for (const key of Object.keys(require.cache)) {
    if (
      key.startsWith(prefix) &&
      !key.includes("/node_modules/") &&
      !/\.test\.tsx?$/.test(key) &&
      !options.keep?.(key)
    ) {
      delete require.cache[key];
    }
  }
}
