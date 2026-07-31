import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { user } from "../db/schema";

export type User = typeof user.$inferSelect;

export async function getUser(id: string): Promise<User | null> {
    const [row] = await db.select().from(user).where(eq(user.id, id)).limit(1);
    return row ?? null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
    const [row] = await db
        .select()
        .from(user)
        .where(eq(user.email, email.toLowerCase()))
        .limit(1);
    return row ?? null;
}
