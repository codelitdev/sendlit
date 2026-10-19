import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Install a happy-dom `window`/`document` on the global object for a test file
 * that renders React. Call it before importing React DOM or Testing Library
 * (load those with `await import()`), the Bun equivalent of
 * `// @vitest-environment jsdom`.
 */
export function registerDom(url = "http://localhost/"): void {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url });
}
