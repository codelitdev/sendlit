"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { ApiError } from "@/lib/api-client";
import { createContact, deleteContact, listContacts } from "@/lib/api";
import { useSegments } from "@/lib/use-segments";
import {
    ContactFilterBuilder,
    TagEditor,
    type Contact,
    type ContactFilterWithAggregator,
} from "@sendlit/email-blocks";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";

const emptyFilter: ContactFilterWithAggregator = {
    aggregator: "or",
    filters: [],
};

export default function ContactsPage() {
    const [contacts, setContacts] = useState<Contact[] | null>(null);
    const [total, setTotal] = useState(0);
    const [filter, setFilter] = useState(emptyFilter);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const { segmentProps, clearSelection } = useSegments(setError);

    useSetBreadcrumb([{ label: "Contacts" }]);

    async function load(nextFilter: ContactFilterWithAggregator = filter) {
        try {
            const { items, total } = await listContacts({
                filter: nextFilter.filters.length > 0 ? nextFilter : undefined,
            });
            setContacts(items);
            setTotal(total);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load contacts",
            );
        }
    }

    useEffect(() => {
        load(filter);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter]);

    return (
        <ScrollablePage>
            <PageHeader
                title="Contacts"
                description="Your audience, filterable into saved segments."
                action={
                    <NewContactDialog
                        open={open}
                        onOpenChange={setOpen}
                        onCreated={() => load()}
                    />
                }
            />

            {error && <Banner className="mb-4">{error}</Banner>}

            <ContactFilterBuilder
                className="mb-4"
                value={filter}
                onChange={(next) => {
                    setFilter(next);
                    clearSelection();
                }}
                {...segmentProps}
                count={contacts === null ? undefined : total}
                countLabel="contacts"
            />

            <Card>
                <CardContent className="p-0">
                    {contacts === null ? (
                        <p className="p-6 text-sm text-muted-foreground">
                            Loading…
                        </p>
                    ) : contacts.length === 0 ? (
                        <p className="p-6 text-sm text-muted-foreground">
                            No contacts yet. Create one to get started.
                        </p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                    <th className="px-4 py-3 font-medium">
                                        Email
                                    </th>
                                    <th className="px-4 py-3 font-medium">
                                        Name
                                    </th>
                                    <th className="px-4 py-3 font-medium">
                                        Tags
                                    </th>
                                    <th className="px-4 py-3 font-medium">
                                        Status
                                    </th>
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {contacts.map((contact) => (
                                    <tr
                                        key={contact.contactId}
                                        className="border-b last:border-0"
                                    >
                                        <td className="px-4 py-3">
                                            <Link
                                                href={`/contacts/${contact.contactId}`}
                                                className="font-medium hover:underline"
                                            >
                                                {contact.email}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            {contact.name || "—"}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1">
                                                {contact.tags.length === 0 && (
                                                    <span className="text-muted-foreground">
                                                        —
                                                    </span>
                                                )}
                                                {contact.tags.map((tag) => (
                                                    <Badge
                                                        key={tag}
                                                        variant="secondary"
                                                    >
                                                        {tag}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge
                                                variant={
                                                    contact.subscribed
                                                        ? "success"
                                                        : "outline"
                                                }
                                            >
                                                {contact.subscribed
                                                    ? "Subscribed"
                                                    : "Unsubscribed"}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={async () => {
                                                    await deleteContact(
                                                        contact.contactId,
                                                    );
                                                    load();
                                                }}
                                            >
                                                <Trash2 className="size-4" />
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>
        </ScrollablePage>
    );
}

function NewContactDialog({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
}) {
    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [customFields, setCustomFields] = useState<
        { key: string; value: string }[]
    >([]);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function submit() {
        setSubmitting(true);
        setError(null);
        try {
            const fields = Object.fromEntries(
                customFields
                    .filter(({ key }) => key.trim())
                    .map(({ key, value }) => [key.trim(), value]),
            );
            await createContact({
                email,
                name: name || undefined,
                tags: tags.length > 0 ? tags : undefined,
                customFields:
                    Object.keys(fields).length > 0 ? fields : undefined,
            });
            setEmail("");
            setName("");
            setTags([]);
            setCustomFields([]);
            onOpenChange(false);
            onCreated();
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to create contact",
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="size-4" />
                    New contact
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New contact</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    {error && <Banner>{error}</Banner>}
                    <div className="space-y-1.5">
                        <Label htmlFor="new-contact-email">Email</Label>
                        <Input
                            id="new-contact-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="jane@example.com"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="new-contact-name">Name</Label>
                        <Input
                            id="new-contact-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Jane Doe"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Tags</Label>
                        <TagEditor
                            tags={tags}
                            onAdd={(tag) =>
                                setTags((current) =>
                                    current.includes(tag)
                                        ? current
                                        : [...current, tag],
                                )
                            }
                            onRemove={(tag) =>
                                setTags((current) =>
                                    current.filter((item) => item !== tag),
                                )
                            }
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Custom fields</Label>
                        {customFields.map((field, index) => (
                            <div
                                key={index}
                                className="flex items-center gap-2"
                            >
                                <Input
                                    className="w-40 shrink-0"
                                    value={field.key}
                                    onChange={(e) =>
                                        setCustomFields((current) =>
                                            current.map((item, i) =>
                                                i === index
                                                    ? {
                                                          ...item,
                                                          key: e.target.value,
                                                      }
                                                    : item,
                                            ),
                                        )
                                    }
                                    placeholder="Field name"
                                />
                                <Input
                                    className="flex-1"
                                    value={field.value}
                                    onChange={(e) =>
                                        setCustomFields((current) =>
                                            current.map((item, i) =>
                                                i === index
                                                    ? {
                                                          ...item,
                                                          value: e.target.value,
                                                      }
                                                    : item,
                                            ),
                                        )
                                    }
                                    placeholder="Value"
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Remove custom field"
                                    onClick={() =>
                                        setCustomFields((current) =>
                                            current.filter(
                                                (_, i) => i !== index,
                                            ),
                                        )
                                    }
                                >
                                    <Trash2 className="size-4" />
                                </Button>
                            </div>
                        ))}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setCustomFields((current) => [
                                    ...current,
                                    { key: "", value: "" },
                                ])
                            }
                        >
                            <Plus className="size-4" />
                            Add field
                        </Button>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={submit} disabled={!email || submitting}>
                        Create contact
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
