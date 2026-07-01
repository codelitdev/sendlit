/**
 * Recursively converts `Date` instances to ISO strings, both at runtime *and*
 * in the type system (via `SerializedDates<T>`). `queries.ts` modules
 * intentionally return raw Drizzle rows (real `Date` objects) since they're
 * framework/transport agnostic; `@sendlit/api-contract`'s schemas declare
 * timestamps as `string` (accurate to what's actually sent over HTTP \u2014
 * `JSON.stringify` would do this same conversion implicitly, but ts-rest's
 * response types are checked against the schema at compile time, so routes
 * need to do it explicitly before returning `{ status, body }`).
 */
export type SerializedDates<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? SerializedDates<U>[]
    : T extends object
      ? { [K in keyof T]: SerializedDates<T[K]> }
      : T;

export function serializeDates<T>(value: T): SerializedDates<T> {
  if (value instanceof Date) {
    return value.toISOString() as SerializedDates<T>;
  }
  if (Array.isArray(value)) {
    return value.map(serializeDates) as SerializedDates<T>;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serializeDates(v);
    }
    return out as SerializedDates<T>;
  }
  return value as SerializedDates<T>;
}
