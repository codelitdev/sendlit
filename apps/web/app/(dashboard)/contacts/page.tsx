"use client";

import type { ContactDeletion } from "@sendlit/api-contract";
import {
  type Contact,
  ContactFilterBuilder,
  type ContactFilterWithAggregator,
  TagEditor,
} from "@sendlit/email-blocks";
import { Download, Plus, Tags, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Banner } from "@/components/dashboard/banner";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { DeleteContactsDialog } from "@/components/dashboard/delete-contacts-dialog";
import { ImportContactsDialog } from "@/components/dashboard/import-contacts-dialog";
import { Loading } from "@/components/dashboard/loading";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/codelit/button";
import { Checkbox } from "@/components/ui/codelit/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/codelit/dialog";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import { Progress } from "@/components/ui/progress";
import {
  type ContactSelection,
  createContact,
  deleteContact,
  exportContacts,
  getContactDeletion,
  listContacts,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { useSegments } from "@/lib/use-segments";

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
  const [contactPendingDelete, setContactPendingDelete] = useState<Contact | null>(
    null,
  );
  const { segmentProps, clearSelection } = useSegments(setError);
  /** Rows ticked on this page, by contact id. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Every contact matching the filter, across pages. */
  const [allMatching, setAllMatching] = useState(false);
  const [bulkSelection, setBulkSelection] = useState<ContactSelection | null>(null);
  const [backgroundDeletion, setBackgroundDeletion] = useState<ContactDeletion | null>(
    null,
  );

  const [exporting, setExporting] = useState(false);

  useSetBreadcrumb([{ label: "Contacts" }]);

  /** Downloads the contacts matching the current filter as CSV. */
  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const csv = await exportContacts(filter.filters.length > 0 ? filter : undefined);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to export contacts");
    } finally {
      setExporting(false);
    }
  }

  async function load(nextFilter: ContactFilterWithAggregator = filter) {
    try {
      const { items, total } = await listContacts({
        filter: nextFilter.filters.length > 0 ? nextFilter : undefined,
      });
      setContacts(items);
      setTotal(total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load contacts");
    }
  }

  function resetSelection() {
    setSelectedIds(new Set());
    setAllMatching(false);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is recreated every render; reload only when the filter changes
  useEffect(() => {
    resetSelection();
    load(filter);
  }, [filter]);

  // Polls a background deletion until it finishes, then reloads the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the deletion id; load is recreated every render
  useEffect(() => {
    const deletionId = backgroundDeletion?.deletionId;
    if (!deletionId || ["completed", "failed"].includes(backgroundDeletion.status)) {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const latest = await getContactDeletion(deletionId);
        setBackgroundDeletion(latest);
        if (latest.status === "completed") {
          toast.success(`Deleted ${latest.deleted.toLocaleString()} contacts`);
          await load();
        } else if (latest.status === "failed") {
          setError("The background deletion stopped. Some contacts may remain.");
          await load();
        }
      } catch {
        // Try again on the next tick.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [backgroundDeletion?.deletionId, backgroundDeletion?.status]);

  const pageIds = contacts?.map((contact) => contact.contactId) ?? [];
  const pageSelected =
    pageIds.length > 0 && pageIds.every((contactId) => selectedIds.has(contactId));
  const selectedCount = allMatching ? total : selectedIds.size;

  return (
    <ScrollablePage>
      <PageHeader
        title="Contacts"
        description="Your audience, filterable into saved segments."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/contacts/tags">
                <Tags className="size-4" />
                Manage tags
              </Link>
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={exporting}>
              <Download className="size-4" />
              {exporting ? "Exporting…" : "Export"}
            </Button>
            <ImportContactsDialog onImported={() => load()} />
            <NewContactDialog
              open={open}
              onOpenChange={setOpen}
              onCreated={() => load()}
            />
          </div>
        }
      />

      {error && <Banner className="mb-4">{error}</Banner>}

      <DeleteConfirmationDialog
        open={contactPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setContactPendingDelete(null);
        }}
        title="Delete contact?"
        description={`This will permanently delete ${contactPendingDelete?.email ?? "this contact"} and its contact data. This action cannot be undone.`}
        onConfirm={async () => {
          if (!contactPendingDelete) return;
          await deleteContact(contactPendingDelete.contactId);
          resetSelection();
          await load();
        }}
      />

      <DeleteContactsDialog
        selection={bulkSelection}
        onOpenChange={(open) => {
          if (!open) setBulkSelection(null);
        }}
        onDeleted={async (deletion) => {
          resetSelection();
          if (deletion.status === "completed") {
            toast.success(`Deleted ${deletion.deleted.toLocaleString()} contacts`);
            await load();
          } else {
            setBackgroundDeletion(deletion);
          }
        }}
      />

      {backgroundDeletion && backgroundDeletion.status !== "completed" && (
        <Card className="mb-4">
          <CardContent className="space-y-2 p-4 text-sm">
            <p>
              {backgroundDeletion.status === "failed"
                ? "Deleting contacts stopped"
                : "Deleting contacts in the background"}
              : {backgroundDeletion.deleted.toLocaleString()} of{" "}
              {backgroundDeletion.count.toLocaleString()} done.
            </p>
            <Progress
              value={
                backgroundDeletion.count
                  ? (backgroundDeletion.deleted / backgroundDeletion.count) * 100
                  : 0
              }
            />
          </CardContent>
        </Card>
      )}

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

      {selectedCount > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-4 py-2 text-sm">
          <span className="font-medium">
            {allMatching
              ? `All ${total.toLocaleString()} matching contacts selected`
              : `${selectedIds.size.toLocaleString()} selected`}
          </span>
          {!allMatching && pageSelected && total > pageIds.length && (
            <Button variant="ghost" size="sm" onClick={() => setAllMatching(true)}>
              Select all {total.toLocaleString()} matching
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={resetSelection}>
            Clear selection
          </Button>
          <Button
            className="ml-auto"
            variant="destructive"
            size="sm"
            onClick={() =>
              setBulkSelection(
                allMatching
                  ? {
                      match: {
                        filter: filter.filters.length > 0 ? filter : undefined,
                      },
                    }
                  : { contactIds: [...selectedIds] },
              )
            }
          >
            <Trash2 className="size-4" />
            Delete {selectedCount.toLocaleString()}{" "}
            {selectedCount === 1 ? "contact" : "contacts"}
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {contacts === null ? (
            <Loading className="p-6" />
          ) : contacts.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No contacts yet. Create one to get started.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="w-10 py-3 pl-4">
                    <Checkbox
                      aria-label="Select all contacts on this page"
                      checked={allMatching || pageSelected}
                      onCheckedChange={(checked) => {
                        setAllMatching(false);
                        setSelectedIds(checked === true ? new Set(pageIds) : new Set());
                      }}
                    />
                  </th>
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
                    <td className="py-3 pl-4">
                      <Checkbox
                        aria-label={`Select ${contact.email}`}
                        checked={allMatching || selectedIds.has(contact.contactId)}
                        onCheckedChange={(checked) => {
                          // Unticking one row leaves "all matching" for this page's ticks.
                          const next = new Set(allMatching ? pageIds : selectedIds);
                          if (checked === true) next.add(contact.contactId);
                          else next.delete(contact.contactId);
                          setAllMatching(false);
                          setSelectedIds(next);
                        }}
                      />
                    </td>
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
                      <Badge variant={contact.subscribed ? "success" : "outline"}>
                        {contact.subscribed ? "Subscribed" : "Unsubscribed"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <IconButton
                        aria-label={`Delete ${contact.email}`}
                        onClick={() => setContactPendingDelete(contact)}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
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
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>(
    [],
  );
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
        customFields: Object.keys(fields).length > 0 ? fields : undefined,
      });
      setEmail("");
      setName("");
      setTags([]);
      setCustomFields([]);
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
          <div className="space-y-1.5">
            <Label>Tags</Label>
            <TagEditor
              tags={tags}
              onAdd={(tag) =>
                setTags((current) =>
                  current.includes(tag) ? current : [...current, tag],
                )
              }
              onRemove={(tag) =>
                setTags((current) => current.filter((item) => item !== tag))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Custom fields</Label>
            {customFields.map((field, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: custom field rows have no id and their key text is user-editable; inputs are fully controlled
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
                <IconButton
                  aria-label="Remove custom field"
                  onClick={() =>
                    setCustomFields((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCustomFields((current) => [...current, { key: "", value: "" }])
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
