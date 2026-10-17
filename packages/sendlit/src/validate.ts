import { SendLitError } from "./errors";

// Public SendLit IDs are `<prefix>_<alphanumerics>`; accepting the URL-safe
// alphabet keeps older or system IDs working while making it impossible to
// smuggle `/`, `?` or `..` into a request path.
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function invalid(message: string): SendLitError {
    return new SendLitError({ status: 0, code: "invalid_argument", message });
}

export function assertId(value: unknown, name: string): string {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) {
        throw invalid(`Invalid ${name}: expected a SendLit ID`);
    }
    return value;
}

/** Path segments that are free-form text (e.g. tag names) are encoded
 * rather than pattern-checked. */
export function encodeSegment(value: unknown, name: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw invalid(`Invalid ${name}: expected a non-empty string`);
    }
    return encodeURIComponent(value);
}
