"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/codelit/button";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import { Switch } from "@/components/ui/codelit/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { ApiError } from "@/lib/api-client";
import {
    addContactTag,
    deleteContact,
    getContact,
    getContactDeliveries,
    removeContactTag,
    updateContact,
    type ContactDelivery,
} from "@/lib/api";
import { TagEditor, type Contact } from "@sendlit/email-blocks";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";

export default function ContactDetailPage({
    params,
}: {
    params: Promise<{ contactId: string }>;
}) {
    const { contactId } = use(params);
    const router = useRouter();
    const [contact, setContact] = useState<Contact | null>(null);
    const [deliveries, setDeliveries] = useState<ContactDelivery[] | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [subscribed, setSubscribed] = useState(false);
    const [customFields, setCustomFields] = useState<Contact["customFields"]>(
        {},
    );
    const [newCustomField, setNewCustomField] = useState({
        key: "",
        value: "",
    });
    const [isSaving, setIsSaving] = useState(false);
    const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);

    useSetBreadcrumb([
        { label: "Contacts", href: "/contacts" },
        { label: contact?.name || contact?.email || "Contact" },
    ]);

    async function load() {
        try {
            const [contact, deliveries] = await Promise.all([
                getContact(contactId),
                getContactDeliveries(contactId),
            ]);
            setContact(contact);
            setName(contact.name ?? "");
            setSubscribed(contact.subscribed);
            setCustomFields(contact.customFields);
            setDeliveries(deliveries);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load contact",
            );
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contactId]);

    const isDirty =
        name !== (contact?.name ?? "") ||
        subscribed !== contact?.subscribed ||
        JSON.stringify(customFields) !==
            JSON.stringify(contact?.customFields) ||
        Boolean(newCustomField.key.trim());

    async function saveChanges() {
        if (!contact || !isDirty) return;

        setIsSaving(true);
        setSaveError(null);
        try {
            const pendingKey = newCustomField.key.trim();
            const fieldsToSave = pendingKey
                ? { ...customFields, [pendingKey]: newCustomField.value }
                : customFields;
            const updated = await updateContact(contact.contactId, {
                name,
                subscribed,
                customFields: fieldsToSave,
            });
            setContact(updated);
            setName(updated.name ?? "");
            setSubscribed(updated.subscribed);
            setCustomFields(updated.customFields);
            setNewCustomField({ key: "", value: "" });
        } catch (err) {
            setSaveError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to save contact changes",
            );
        } finally {
            setIsSaving(false);
        }
    }

    if (error) return <Banner>{error}</Banner>;
    if (!contact)
        return <p className="text-sm text-muted-foreground">Loading…</p>;

    return (
        <ScrollablePage>
            <div className="max-w-2xl">
                <PageHeader
                    title={contact.name || contact.email}
                    description={contact.email}
                    action={
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={saveChanges}
                                disabled={!isDirty || isSaving}
                            >
                                {isSaving ? "Saving…" : "Save changes"}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => setDeleteConfirmationOpen(true)}
                            >
                                <Trash2 className="size-4" />
                                Delete
                            </Button>
                        </div>
                    }
                />

                <DeleteConfirmationDialog
                    open={deleteConfirmationOpen}
                    onOpenChange={setDeleteConfirmationOpen}
                    title="Delete contact?"
                    description={`This will permanently delete ${contact.email} and its contact data. This action cannot be undone.`}
                    onConfirm={async () => {
                        await deleteContact(contact.contactId);
                        router.push("/contacts");
                    }}
                />

                <div className="space-y-6">
                    {saveError && <Banner>{saveError}</Banner>}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="max-w-sm space-y-1.5">
                                <Label htmlFor="contact-name">Name</Label>
                                <Input
                                    id="contact-name"
                                    value={name}
                                    onChange={(event) =>
                                        setName(event.target.value)
                                    }
                                />
                            </div>
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="contact-subscribed"
                                    checked={subscribed}
                                    onCheckedChange={setSubscribed}
                                />
                                <Label htmlFor="contact-subscribed">
                                    Subscribed to broadcasts &amp; sequences
                                </Label>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Tags</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <TagEditor
                                tags={contact.tags}
                                onAdd={async (tag) =>
                                    setContact(
                                        await addContactTag(
                                            contact.contactId,
                                            tag,
                                        ),
                                    )
                                }
                                onRemove={async (tag) =>
                                    setContact(
                                        await removeContactTag(
                                            contact.contactId,
                                            tag,
                                        ),
                                    )
                                }
                            />
                            <p className="text-sm text-muted-foreground">
                                Tag changes are saved immediately.
                            </p>
                        </CardContent>
                    </Card>

                    <CustomFieldsCard
                        customFields={customFields}
                        onChange={setCustomFields}
                        newField={newCustomField}
                        onNewFieldChange={setNewCustomField}
                    />

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                Delivery history
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {!deliveries || deliveries.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No broadcasts or sequence emails delivered
                                    yet.
                                </p>
                            ) : (
                                <ul className="space-y-2">
                                    {deliveries.map((delivery, index) => (
                                        <li
                                            key={`${delivery.sequenceId}-${delivery.emailId}-${index}`}
                                            className="flex items-center gap-3 rounded-lg border p-3 text-sm"
                                        >
                                            <Mail className="size-4 shrink-0 text-muted-foreground" />
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-medium">
                                                    {delivery.sequenceTitle ||
                                                        "Untitled"}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {delivery.createdAt
                                                        ? new Date(
                                                              delivery.createdAt,
                                                          ).toLocaleString()
                                                        : ""}
                                                </p>
                                            </div>
                                            <Badge variant="secondary">
                                                {delivery.sequenceType}
                                            </Badge>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </ScrollablePage>
    );
}

function CustomFieldsCard({
    customFields,
    onChange,
    newField,
    onNewFieldChange,
}: {
    customFields: Contact["customFields"];
    onChange: (fields: Contact["customFields"]) => void;
    newField: { key: string; value: string };
    onNewFieldChange: (field: { key: string; value: string }) => void;
}) {
    function removeField(key: string) {
        const next = { ...customFields };
        delete next[key];
        onChange(next);
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Custom fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {Object.entries(customFields).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                        <Input
                            className="w-40 shrink-0"
                            defaultValue={key}
                            disabled
                        />
                        <Input
                            className="flex-1"
                            value={
                                Array.isArray(value)
                                    ? value.join(", ")
                                    : String(value)
                            }
                            onChange={(event) =>
                                onChange({
                                    ...customFields,
                                    [key]: event.target.value,
                                })
                            }
                        />
                        <IconButton
                            aria-label={`Remove ${key} field`}
                            onClick={() => removeField(key)}
                        >
                            <X className="size-4" />
                        </IconButton>
                    </div>
                ))}
                <div className="flex items-center gap-2">
                    <Input
                        className="w-40 shrink-0"
                        placeholder="Key"
                        value={newField.key}
                        onChange={(event) =>
                            onNewFieldChange({
                                ...newField,
                                key: event.target.value,
                            })
                        }
                    />
                    <Input
                        className="flex-1"
                        placeholder="Value"
                        value={newField.value}
                        onChange={(event) =>
                            onNewFieldChange({
                                ...newField,
                                value: event.target.value,
                            })
                        }
                    />
                </div>
            </CardContent>
        </Card>
    );
}
