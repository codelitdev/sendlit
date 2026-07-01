"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
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

export default function ContactDetailPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = use(params);
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [deliveries, setDeliveries] = useState<ContactDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [contact, deliveries] = await Promise.all([
        getContact(contactId),
        getContactDeliveries(contactId),
      ]);
      setContact(contact);
      setDeliveries(deliveries);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load contact",
      );
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  if (error) return <Banner>{error}</Banner>;
  if (!contact)
    return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <ScrollablePage>
    <div className="max-w-2xl">
      <Link
        href="/dashboard/contacts"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to contacts
      </Link>

      <PageHeader
        title={contact.name || contact.email}
        description={contact.email}
        action={
          <Button
            variant="destructive"
            onClick={async () => {
              await deleteContact(contact.contactId);
              router.push("/dashboard/contacts");
            }}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="contact-name">Name</Label>
              <Input
                id="contact-name"
                defaultValue={contact.name ?? ""}
                onBlur={async (e) => {
                  setContact(
                    await updateContact(contact.contactId, {
                      name: e.target.value,
                    }),
                  );
                }}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="contact-subscribed"
                checked={contact.subscribedToUpdates}
                onCheckedChange={async (subscribedToUpdates) => {
                  setContact(
                    await updateContact(contact.contactId, {
                      subscribedToUpdates,
                    }),
                  );
                }}
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
          <CardContent>
            <TagEditor
              tags={contact.tags}
              onAdd={async (tag) =>
                setContact(await addContactTag(contact.contactId, tag))
              }
              onRemove={async (tag) =>
                setContact(await removeContactTag(contact.contactId, tag))
              }
            />
          </CardContent>
        </Card>

        <CustomFieldsCard contact={contact} onUpdate={setContact} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delivery history</CardTitle>
          </CardHeader>
          <CardContent>
            {!deliveries || deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No broadcasts or sequence emails delivered yet.
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
                        {delivery.sequenceTitle || "Untitled"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {delivery.createdAt
                          ? new Date(delivery.createdAt).toLocaleString()
                          : ""}
                      </p>
                    </div>
                    <Badge variant="secondary">{delivery.sequenceType}</Badge>
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
  contact,
  onUpdate,
}: {
  contact: Contact;
  onUpdate: (c: Contact) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  async function save(fields: Record<string, string>) {
    const updated = await updateContact(contact.contactId, { customFields: fields });
    onUpdate(updated);
  }

  async function addField() {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key) return;
    await save({ ...contact.customFields, [key]: value });
    setNewKey("");
    setNewValue("");
  }

  async function removeField(key: string) {
    const next = { ...contact.customFields };
    delete next[key];
    await save(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Custom fields</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {Object.entries(contact.customFields).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <Input
              className="w-40 shrink-0"
              defaultValue={key}
              disabled
            />
            <Input
              className="flex-1"
              defaultValue={value}
              onBlur={async (e) => {
                if (e.target.value === value) return;
                await save({ ...contact.customFields, [key]: e.target.value });
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeField(key)}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            className="w-40 shrink-0"
            placeholder="Key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <Input
            className="flex-1"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addField()}
          />
          <Button variant="outline" size="icon" onClick={addField} disabled={!newKey.trim()}>
            <Plus className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
