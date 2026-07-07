"use client";

import { useEffect, useState } from "react";
import type {
    ContactFilterSegment,
    ContactFilterWithAggregator,
} from "@sendlit/email-blocks";
import { ApiError } from "./api-client";
import {
    createSegment,
    deleteSegment,
    listSegments,
    type Segment,
} from "./api";

function toBuilderSegment(segment: Segment): ContactFilterSegment {
    return {
        id: segment.segmentId,
        name: segment.name,
        filter: segment.filter,
    };
}

/**
 * Wires `ContactFilterBuilder`'s segment props to the `/segments` API: loads
 * the team's saved segments, and persists saves/deletes made from the builder.
 * Spread the returned `segmentProps` onto a `ContactFilterBuilder`, and call
 * `clearSelection` from its `onChange` so hand-edits to the filter deselect
 * the segment they diverged from.
 */
export function useSegments(onError: (message: string) => void) {
    const [segments, setSegments] = useState<ContactFilterSegment[]>([]);
    const [selectedSegmentId, setSelectedSegmentId] = useState("");

    useEffect(() => {
        listSegments()
            .then((items) => setSegments(items.map(toBuilderSegment)))
            .catch((err) =>
                onError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load segments",
                ),
            );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function onSaveSegment(
        name: string,
        filter: ContactFilterWithAggregator,
    ) {
        try {
            const created = await createSegment({ name, filter });
            setSegments((await listSegments()).map(toBuilderSegment));
            setSelectedSegmentId(created.segmentId);
        } catch (err) {
            onError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to save segment",
            );
        }
    }

    async function onDeleteSegment(segment: ContactFilterSegment) {
        try {
            await deleteSegment(segment.id);
            setSegments((prev) => prev.filter((s) => s.id !== segment.id));
        } catch (err) {
            onError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to delete segment",
            );
        }
    }

    return {
        clearSelection: () => setSelectedSegmentId(""),
        segmentProps: {
            segments,
            selectedSegmentId,
            onSegmentSelect: (segment: ContactFilterSegment) =>
                setSelectedSegmentId(segment.id),
            onSaveSegment,
            onDeleteSegment,
        },
    };
}
