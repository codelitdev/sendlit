import { serializeDates } from "../../utils/serialize";

export const AUTH_ERROR = {
    content: [
        {
            type: "text" as const,
            text: "Authentication required: valid API credentials were not provided.",
        },
    ],
    isError: true,
};

export const INTERNAL_ERROR = {
    content: [
        {
            type: "text" as const,
            text: "An error occurred while processing your request.",
        },
    ],
    isError: true,
};

export const NOT_FOUND = {
    content: [{ type: "text" as const, text: "Not found." }],
    isError: true,
};

export function errorResult(message: string) {
    return {
        content: [{ type: "text" as const, text: message }],
        isError: true,
    };
}

export function jsonResult(data: unknown) {
    const serialized = serializeDates(data ?? {}) as Record<string, unknown>;
    return {
        content: [{ type: "text" as const, text: JSON.stringify(serialized) }],
        structuredContent: serialized,
    };
}

export function planGateResult(error: {
    code: string;
    details?: Record<string, unknown>;
    status?: number;
}) {
    const details = { error: error.code, ...(error.details ?? {}) };
    return {
        content: [{ type: "text" as const, text: JSON.stringify(details) }],
        structuredContent: details,
        isError: true,
    };
}

export function isPlanGateError(error: unknown): error is {
    code: string;
    details?: Record<string, unknown>;
    status?: number;
} {
    return Boolean(
        error &&
        typeof error === "object" &&
        (error as any).name === "PlanGateError",
    );
}
