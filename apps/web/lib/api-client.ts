"use client";

import {
    clearTeamIdCookie,
    isStaleTeamSelectionError,
    needsTeamSelection,
} from "./tokens";

export class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.name = "ApiError";
    }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`/api/proxy${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        cache: "no-store",
    });

    if (res.status === 401 && typeof window !== "undefined") {
        window.location.href = "/login";
        // Never resolves — the browser is navigating away.
        return new Promise<T>(() => {});
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;

    if (typeof window !== "undefined") {
        if (
            needsTeamSelection(res.status, data?.error) &&
            !window.location.pathname.startsWith("/dashboard/teams")
        ) {
            if (isStaleTeamSelectionError(data?.error)) {
                clearTeamIdCookie();
            }
            window.location.href = "/dashboard/teams";
            return new Promise<T>(() => {});
        }
    }

    if (!res.ok) {
        throw new ApiError(res.status, data?.error || res.statusText);
    }

    return data as T;
}

export const apiClient = {
    get: <T>(path: string): Promise<T> => request<T>(path),
    post: <T>(path: string, body?: unknown): Promise<T> =>
        request<T>(path, {
            method: "POST",
            body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
    patch: <T>(path: string, body?: unknown): Promise<T> =>
        request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
    put: <T>(path: string, body?: unknown): Promise<T> =>
        request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
    delete: <T>(path: string): Promise<T> =>
        request<T>(path, { method: "DELETE" }),
};
