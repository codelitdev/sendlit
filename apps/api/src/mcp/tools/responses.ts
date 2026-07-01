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
    return {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        structuredContent: (data ?? {}) as Record<string, unknown>,
    };
}
