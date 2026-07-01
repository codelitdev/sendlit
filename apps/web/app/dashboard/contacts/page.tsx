"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
} from "@/components/ui/card";
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
import type { Contact } from "@sendlit/email-blocks";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";

export default function ContactsPage() {
    const [contacts, setContacts] = useState<Contact[] | null>(null);
    const [total, setTotal] = useState(0);
    const [q, setQ] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    async function load(searchText?: string) {
        try {
            const { items, total } = await listContacts({ q: searchText });
            setContacts(items);
            setTotal(total);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load contacts");
        }
    }

    useEffect(() => {
        load();
    }, []);

    return (
        <ScrollablePage>
            <PageHeader
                title="Contacts"
                description={`${total} contact${total === 1 ? "" : "s"}`}
                action={<NewContactDialog open={open} onOpenChange={setOpen} onCreated={() => load(q)} />}
            />

            {error && <Banner className="mb-4">{error}</Banner>}

            <form
                className="mb-4 flex max-w-sm gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    load(q);
                }}
            >
                <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search by email or name"
                />
                <Button type="submit" variant="outline" size="icon">
                    <Search className="size-4" />
                </Button>
            </form>

            <Card>
                <CardContent className="p-0">
                    {contacts === null ? (
                        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
                    ) : contacts.length === 0 ? (
                        <p className="p-6 text-sm text-muted-foreground">
                            No contacts yet. Create one to get started.
                        </p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                    <th className="px-4 py-3 font-medium">Email</th>
                                    <th className="px-4 py-3 font-medium">Name</th>
                                    <th className="px-4 py-3 font-medium">Tags</th>
                                    <th className="px-4 py-3 font-medium">Status</th>
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {contacts.map((contact) => (
                                    <tr key={contact.contactId} className="border-b last:border-0">
                                        <td className="px-4 py-3">
                                            <Link
                                                href={`/dashboard/contacts/${contact.contactId}`}
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
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                                {contact.tags.map((tag) => (
                                                    <Badge key={tag} variant="secondary">
                                                        {tag}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge
                                                variant={
                                                    contact.subscribedToUpdates ? "success" : "outline"
                                                }
                                            >
                                                {contact.subscribedToUpdates
                                                    ? "Subscribed"
                                                    : "Unsubscribed"}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={async () => {
                                                    await deleteContact(contact.contactId);
                                                    load(q);
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
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function submit() {
        setSubmitting(true);
        setError(null);
        try {
            await createContact({ email, name: name || undefined });
            setEmail("");
            setName("");
            onOpenChange(false);
            onCreated();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to create contact");
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
