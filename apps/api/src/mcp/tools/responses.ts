import {
  createPlatformError,
  type PlatformError,
  type PlatformErrorCode,
  type PlatformSafeDetails,
} from "@codelitdev/platform";
import { PlanGateError } from "../../billing/errors";

/** A tool's failure: the kit returns it as an `isError` result carrying the
 * platform `code`, plus `details` (a stable `reason`, and a `message` for the
 * model when the reason alone is not enough). */
export type ToolError = { error: PlatformError };

export function toolError(
  code: PlatformErrorCode,
  details?: PlatformSafeDetails,
): ToolError {
  return { error: createPlatformError(code, details ? { safeDetails: details } : {}) };
}

export const notFound = (): ToolError => toolError("not_found");

/** A plan limit, keeping the REST error code as the `reason` and the
 * primitive details (limit, usage, upgrade URL) that REST also returns. */
export function planGateError(error: PlanGateError): ToolError {
  const details: Record<string, string | number | boolean | null> = {
    reason: error.code,
  };
  for (const [key, value] of Object.entries(error.details)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      details[key] = value as string | number | boolean | null;
    }
  }
  return toolError("forbidden", details);
}

export function isPlanGateError(error: unknown): error is PlanGateError {
  return error instanceof PlanGateError;
}
