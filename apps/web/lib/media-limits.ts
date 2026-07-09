/**
 * Isomorphic constants/helpers for image upload limits — safe to import from
 * both server and client code (no `process.env` access here; the actual
 * env-derived value is read server-side in `lib/config.ts` and threaded down
 * to client components via `MaxUploadSizeProvider`).
 */

export const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export function formatFileSize(bytes: number) {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(0)} KB`;
}
