/**
 * Strips internal-only columns — the internal surrogate `id` and, when
 * present, the internal `teamId` tenant FK — before a row is handed to any
 * REST/MCP response. Every route/tool handler must funnel its response
 * through this instead of returning a raw Drizzle row. See the `id` vs
 * `<domain>_id` convention documented at the top of `db/schema.ts`.
 */
export function omitInternal<T extends Record<string, unknown>>(
    row: T,
    extraKeys: (keyof T)[] = [],
): Omit<T, "id" | "teamId"> {
    const clone: any = { ...row };
    delete clone.id;
    delete clone.teamId;
    for (const key of extraKeys) delete clone[key];
    return clone;
}
