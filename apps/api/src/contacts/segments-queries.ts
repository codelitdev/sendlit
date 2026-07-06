import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client";
import { segments } from "../db/schema";
import { type ContactFilterWithAggregator } from "./segment";

export type Segment = typeof segments.$inferSelect;

async function assertUniqueName(
    teamId: string,
    name: string,
    excludeSegmentId?: string,
): Promise<void> {
    const conditions = [eq(segments.teamId, teamId), eq(segments.name, name)];
    if (excludeSegmentId) {
        conditions.push(ne(segments.segmentId, excludeSegmentId));
    }
    const [clash] = await db
        .select({ segmentId: segments.segmentId })
        .from(segments)
        .where(and(...conditions))
        .limit(1);
    if (clash) {
        throw new Error("duplicate_name");
    }
}

export async function createSegment({
    teamId,
    name,
    filter,
}: {
    teamId: string;
    name: string;
    filter: ContactFilterWithAggregator;
}): Promise<Segment> {
    await assertUniqueName(teamId, name);
    const [segment] = await db
        .insert(segments)
        .values({
            teamId,
            name,
            filter,
        })
        .returning();
    return segment;
}

export async function listSegments(teamId: string): Promise<Segment[]> {
    return db.select().from(segments).where(eq(segments.teamId, teamId));
}

export async function getSegment(segmentId: string): Promise<Segment | null> {
    const [row] = await db
        .select()
        .from(segments)
        .where(eq(segments.segmentId, segmentId))
        .limit(1);
    return row ?? null;
}

export async function updateSegment({
    teamId,
    segmentId,
    name,
    filter,
}: {
    teamId: string;
    segmentId: string;
    name?: string;
    filter?: ContactFilterWithAggregator;
}): Promise<Segment | null> {
    if (name) {
        await assertUniqueName(teamId, name, segmentId);
    }

    const patch: Partial<Segment> = { updatedAt: new Date() };
    if (name) patch.name = name;
    if (filter) patch.filter = filter;

    const [row] = await db
        .update(segments)
        .set(patch)
        .where(
            and(eq(segments.teamId, teamId), eq(segments.segmentId, segmentId)),
        )
        .returning();
    return row ?? null;
}

export async function deleteSegment(
    teamId: string,
    segmentId: string,
): Promise<void> {
    await db
        .delete(segments)
        .where(
            and(eq(segments.teamId, teamId), eq(segments.segmentId, segmentId)),
        );
}
