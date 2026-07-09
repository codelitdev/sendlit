"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import {
    deleteMedia,
    listMedia,
    listMediaReferences,
    updateMediaMetadata,
    type Media,
    type MediaReference,
} from "@/lib/api";

type MediaWithReferences = Media & { references: MediaReference[] };

const PAGE_SIZE = 50;

export default function MediaPage() {
    const [items, setItems] = useState<MediaWithReferences[] | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [query, setQuery] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);

    // Fetches the first `pageCount` pages worth of items in one request
    // (rather than appending page-by-page), so refreshing after an edit can
    // re-fetch everything the user has already loaded without losing it.
    async function loadRange(search: string, pageCount: number) {
        const result = await listMedia({
            query: search || undefined,
            page: 1,
            pageSize: PAGE_SIZE * pageCount,
        });
        const references = await Promise.all(
            result.items.map((item) =>
                listMediaReferences(item.mediaId)
                    .then((res) => res.items)
                    .catch(() => []),
            ),
        );
        return {
            items: result.items.map((item, index) => ({
                ...item,
                references: references[index],
            })),
            total: result.total,
        };
    }

    async function load(search = query) {
        setError(null);
        try {
            const result = await loadRange(search, 1);
            setItems(result.items);
            setTotal(result.total);
            setPage(1);
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to load media",
            );
        }
    }

    // Re-fetches the currently loaded pages (used after save/delete), so the
    // gallery doesn't collapse back to page 1.
    async function refresh() {
        setError(null);
        try {
            const result = await loadRange(query, page);
            setItems(result.items);
            setTotal(result.total);
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to load media",
            );
        }
    }

    async function loadMore() {
        if (loadingMore) return;
        setLoadingMore(true);
        setError(null);
        try {
            const nextPage = page + 1;
            const result = await loadRange(query, nextPage);
            setItems(result.items);
            setTotal(result.total);
            setPage(nextPage);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load more media",
            );
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        void load("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selectedItem = useMemo(
        () => items?.find((item) => item.mediaId === selectedId) || null,
        [items, selectedId],
    );

    return (
        <ScrollablePage>
            <PageHeader
                title="Media"
                description="Uploaded image assets used by saved emails."
                action={
                    <form
                        className="flex gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void load(query);
                        }}
                    >
                        <Input
                            className="w-64"
                            placeholder="Search media"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                        <Button type="submit" variant="outline">
                            Search
                        </Button>
                    </form>
                }
            />

            {error && <Banner className="mb-4">{error}</Banner>}

            {items === null ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
            ) : items.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                        No uploaded media yet.
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="columns-2 gap-4 sm:columns-3 lg:columns-4 xl:columns-5">
                        {items.map((item) => (
                            <div
                                key={item.mediaId}
                                className="mb-4 break-inside-avoid"
                            >
                                <MediaTile
                                    item={item}
                                    onClick={() => setSelectedId(item.mediaId)}
                                />
                            </div>
                        ))}
                    </div>

                    {items.length < total && (
                        <div className="mt-4 flex flex-col items-center gap-2">
                            <p className="text-xs text-muted-foreground">
                                Showing {items.length} of {total}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={loadingMore}
                                onClick={() => void loadMore()}
                            >
                                {loadingMore ? "Loading..." : "Load more"}
                            </Button>
                        </div>
                    )}
                </>
            )}

            <MediaDetailsDialog
                item={selectedItem}
                saving={
                    selectedItem !== null && savingId === selectedItem.mediaId
                }
                onOpenChange={(open) => {
                    if (!open) setSelectedId(null);
                }}
                onSave={async (patch) => {
                    if (!selectedItem) return;
                    setSavingId(selectedItem.mediaId);
                    try {
                        await updateMediaMetadata(selectedItem.mediaId, patch);
                        await refresh();
                    } catch (err) {
                        setError(
                            err instanceof ApiError
                                ? err.message
                                : "Failed to update media",
                        );
                    } finally {
                        setSavingId(null);
                    }
                }}
                onDelete={async () => {
                    if (!selectedItem) return;
                    setSavingId(selectedItem.mediaId);
                    try {
                        await deleteMedia(selectedItem.mediaId);
                        setSelectedId(null);
                        await refresh();
                    } catch (err) {
                        setError(
                            err instanceof ApiError
                                ? err.message
                                : "Failed to delete media",
                        );
                    } finally {
                        setSavingId(null);
                    }
                }}
            />
        </ScrollablePage>
    );
}

function MediaTile({
    item,
    onClick,
}: {
    item: MediaWithReferences;
    onClick: () => void;
}) {
    const inUse = item.references.length > 0;

    return (
        <button
            type="button"
            onClick={onClick}
            className="group block w-full overflow-hidden rounded-lg border text-left transition-colors hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
        >
            <div className="relative bg-muted">
                <img
                    src={item.thumbnailUrl || item.url}
                    alt={item.alt || item.fileName || "Media"}
                    className="block h-auto w-full"
                    loading="lazy"
                />
                {inUse && (
                    <Badge
                        variant="secondary"
                        className="absolute top-2 right-2"
                    >
                        {item.references.length} use
                        {item.references.length === 1 ? "" : "s"}
                    </Badge>
                )}
            </div>
            {(item.fileName || item.alt || item.caption) && (
                <p className="truncate px-2 py-2 text-sm font-medium">
                    {item.fileName || item.alt || item.caption}
                </p>
            )}
        </button>
    );
}

function MediaDetailsDialog({
    item,
    saving,
    onOpenChange,
    onSave,
    onDelete,
}: {
    item: MediaWithReferences | null;
    saving: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (patch: { alt?: string | null; caption?: string | null }) => void;
    onDelete: () => void;
}) {
    const [alt, setAlt] = useState("");
    const [caption, setCaption] = useState("");

    useEffect(() => {
        setAlt(item?.alt || "");
        setCaption(item?.caption || "");
    }, [item]);

    const inUse = (item?.references.length || 0) > 0;
    const usageLabel = useMemo(() => {
        if (!item) return "";
        if (!inUse) return "Unused";
        return `${item.references.length} use${
            item.references.length === 1 ? "" : "s"
        }`;
    }, [inUse, item]);

    return (
        <Dialog open={item !== null} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                {item && (
                    <>
                        <DialogHeader>
                            <DialogTitle className="truncate">
                                {item.fileName ||
                                    item.alt ||
                                    item.caption ||
                                    "Untitled image"}
                            </DialogTitle>
                        </DialogHeader>

                        <div className="flex max-h-[60vh] items-center justify-center overflow-hidden rounded-md bg-muted">
                            <img
                                src={item.thumbnailUrl || item.url}
                                alt={item.alt || item.fileName || "Media"}
                                className="max-h-[60vh] w-full object-contain"
                            />
                        </div>

                        <p className="text-xs text-muted-foreground">
                            {usageLabel}
                        </p>

                        {inUse ? (
                            <div className="space-y-1 text-xs text-muted-foreground">
                                {item.references
                                    .slice(0, 3)
                                    .map((reference) => (
                                        <p
                                            key={`${reference.resourceType}:${reference.resourcePublicId}`}
                                            className="truncate"
                                        >
                                            {reference.resourceType ===
                                            "TEMPLATE"
                                                ? "Template"
                                                : "Email"}{" "}
                                            {reference.parentResourcePublicId
                                                ? `${reference.parentResourcePublicId} / `
                                                : ""}
                                            {reference.resourcePublicId}
                                        </p>
                                    ))}
                            </div>
                        ) : null}

                        <div className="space-y-2">
                            <Label htmlFor={`${item.mediaId}-alt`}>
                                Alt text
                            </Label>
                            <Input
                                id={`${item.mediaId}-alt`}
                                value={alt}
                                onChange={(event) => setAlt(event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`${item.mediaId}-caption`}>
                                Caption
                            </Label>
                            <Input
                                id={`${item.mediaId}-caption`}
                                value={caption}
                                onChange={(event) =>
                                    setCaption(event.target.value)
                                }
                            />
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={saving || inUse}
                                onClick={onDelete}
                            >
                                <Trash2 className="size-4" />
                                Delete
                            </Button>
                            <Button
                                type="button"
                                disabled={saving}
                                onClick={() => onSave({ alt, caption })}
                            >
                                <Save className="size-4" />
                                Save
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
