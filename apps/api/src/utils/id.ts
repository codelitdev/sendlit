import { randomUUID } from "crypto";

export function generateUniqueId(): string {
    return randomUUID();
}
