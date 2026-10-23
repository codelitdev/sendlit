"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { Loading } from "@/components/dashboard/loading";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import {
  embedSnippet,
  SignupFormDialog,
} from "@/components/dashboard/signup-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { Textarea } from "@/components/ui/codelit/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteSignupForm, listSignupForms, type SignupForm } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

export default function SignupFormsPage() {
  useSetBreadcrumb([{ label: "Signup forms" }]);
  const [forms, setForms] = useState<SignupForm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SignupForm | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [embedding, setEmbedding] = useState<SignupForm | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState<SignupForm | null>(null);

  // The issue is the team's, so every affected form reports the same one.
  const sendingIssue = forms?.find((form) => form.sendingIssue)?.sendingIssue ?? null;

  async function load() {
    setError(null);
    try {
      setForms((await listSignupForms()).items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load signup forms");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);

  function openEditor(form: SignupForm | null) {
    setEditing(form);
    setDialogOpen(true);
  }

  async function remove() {
    if (!deleting) return;
    await deleteSignupForm(deleting.formId);
    setDeleting(null);
    await load();
  }

  return (
    <ScrollablePage>
      <PageHeader
        title="Signup forms"
        description="Let people subscribe themselves. Share a form's hosted page, or paste its HTML into your website."
        action={
          <Button onClick={() => openEditor(null)}>
            <Plus className="size-4" />
            New form
          </Button>
        }
      />

      {error && <Banner className="mb-4">{error}</Banner>}
      {sendingIssue && (
        <Banner variant="warning" className="mb-4">
          Double opt-in forms can&apos;t email confirmation links, so their signups
          fail. {sendingIssue}{" "}
          <Link href="/settings?tab=esp" className="underline underline-offset-4">
            Open email settings
          </Link>
        </Banner>
      )}

      <Card>
        <CardContent className="p-0">
          {forms === null ? (
            <Loading className="p-6" />
          ) : forms.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No signup forms yet. Create one to start collecting subscribers.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Opt-in</TableHead>
                  <TableHead>Hosted page</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {forms.map((form) => (
                  <TableRow key={form.formId}>
                    <TableCell className="font-medium">{form.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {form.tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">
                          {form.doubleOptIn ? "Double" : "Single"}
                        </Badge>
                        {form.sendingIssue && (
                          <Badge variant="destructive">
                            Can&apos;t send confirmations
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <a
                        href={form.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline underline-offset-4"
                      >
                        Open
                      </a>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setCopied(false);
                            setEmbedding(form);
                          }}
                        >
                          Embed
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditor(form)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleting(form)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DeleteConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete signup form?"
        description={`"${deleting?.name ?? ""}" stops accepting signups. Contacts who already subscribed stay on your list.`}
        onConfirm={remove}
      />

      <SignupFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={editing}
        onSaved={() => void load()}
      />

      <Dialog
        open={embedding !== null}
        onOpenChange={(open) => !open && setEmbedding(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Embed &quot;{embedding?.name}&quot;</DialogTitle>
            <DialogDescription>
              Paste this HTML into your website and style it as you like. Keep the field
              names; the hidden <code>website</code> field catches spam bots. You can
              also post <code>{"{ email, name }"}</code> as JSON to the same URL.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            readOnly
            rows={9}
            className="font-mono text-xs"
            value={embedding ? embedSnippet(embedding) : ""}
          />
          <DialogFooter>
            <Button
              onClick={() => {
                if (!embedding) return;
                void navigator.clipboard.writeText(embedSnippet(embedding));
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy HTML"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollablePage>
  );
}
