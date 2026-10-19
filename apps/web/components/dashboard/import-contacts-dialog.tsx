"use client";

import {
  type ContactImportField,
  guessContactImportField,
  normalizeImportHeader,
} from "@sendlit/api-contract";
import { Upload } from "lucide-react";
import Papa from "papaparse";
import { useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { Button } from "@/components/ui/codelit/button";
import { Checkbox } from "@/components/ui/codelit/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/codelit/select";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type ImportContactRow,
  type ImportContactsResult,
  importContacts,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";

/** Rows sent per request; the API accepts at most 1000. */
const CHUNK_SIZE = 1000;

const FIELD_LABELS: Record<ContactImportField, string> = {
  email: "Email",
  name: "Name",
  first_name: "First name",
  last_name: "Last name",
  tags: "Tags (comma-separated)",
  status: "Subscription status",
  created_at: "Signup date",
  tag_from_value: "Tag from value",
  custom_field: "Custom field",
  ignore: "Don't import",
};

const SKIP_REASONS: Record<ImportContactsResult["skipped"][number]["reason"], string> =
  {
    invalid_email: "Invalid email address",
    duplicate: "Duplicate of an earlier row",
    pending_confirmation: "Never confirmed their subscription",
    unknown_status: "Unrecognised status",
    plan_limit_reached: "Over your plan's contact limit",
  };

type Step = "pick" | "map" | "importing" | "done";

interface ParsedCsv {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

/** Builds the API rows from the CSV rows and the chosen column mapping. */
function toImportRows(
  csv: ParsedCsv,
  mapping: Record<string, ContactImportField>,
): ImportContactRow[] {
  const columns = (field: ContactImportField) =>
    csv.headers.filter((header) => mapping[header] === field);
  const [emailColumn] = columns("email");
  return csv.rows.map((record, index) => {
    const value = (header: string) => record[header]?.trim() ?? "";
    const first = (field: ContactImportField) =>
      columns(field)
        .map(value)
        .find((v) => v) || undefined;
    const name =
      first("name") ||
      [first("first_name"), first("last_name")].filter(Boolean).join(" ") ||
      undefined;
    const tags = [
      ...columns("tags").flatMap((header) => value(header).split(/[,;]/)),
      ...columns("tag_from_value")
        .filter((header) => value(header))
        .map((header) => `${normalizeImportHeader(header)}:${value(header)}`),
    ]
      .map((tag) => tag.trim())
      .filter(Boolean);
    const customFields = Object.fromEntries(
      columns("custom_field")
        .filter((header) => value(header))
        .map((header) => [normalizeImportHeader(header), value(header)]),
    );
    return {
      // The header is line 1, so data row 0 is line 2 of the file.
      row: index + 2,
      email: value(emailColumn),
      ...(name && { name }),
      ...(tags.length > 0 && { tags }),
      ...(first("status") !== undefined && { status: first("status") }),
      ...(first("created_at") && { createdAt: first("created_at") }),
      ...(Object.keys(customFields).length > 0 && { customFields }),
    };
  });
}

/**
 * Imports contacts from another platform's CSV export (beehiiv, Mailchimp,
 * Substack, Kit, ...). The file is parsed in the browser, columns are mapped
 * (pre-filled from common export headers) and rows are sent in chunks; the
 * API decides each row's status and reports what it skipped.
 */
export function ImportContactsDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("pick");
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, ContactImportField>>({});
  const [tagsForAll, setTagsForAll] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportContactsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("pick");
    setCsv(null);
    setMapping({});
    setTagsForAll("");
    setImportPending(false);
    setProgress(0);
    setResult(null);
    setError(null);
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: ({ data, meta }) => {
        const headers = (meta.fields ?? []).filter((header) => header.trim());
        if (headers.length === 0 || data.length === 0) {
          setError("The file has no header row or no contacts.");
          return;
        }
        const guessed = Object.fromEntries(
          headers.map((header) => [header, guessContactImportField(header)]),
        );
        // Keep only the first email-looking column as the email.
        let emailSeen = false;
        for (const header of headers) {
          if (guessed[header] !== "email") continue;
          if (emailSeen) guessed[header] = "ignore";
          emailSeen = true;
        }
        setCsv({ fileName: file.name, headers, rows: data });
        setMapping(guessed);
        setStep("map");
      },
      error: (err) => setError(`Couldn't read the file: ${err.message}`),
    });
  }

  const emailColumns = csv
    ? csv.headers.filter((header) => mapping[header] === "email").length
    : 0;

  async function runImport() {
    if (!csv) return;
    const rows = toImportRows(csv, mapping);
    const tags = tagsForAll
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const total: ImportContactsResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      suppressed: 0,
      skipped: [],
    };
    setStep("importing");
    setError(null);
    try {
      for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
        const chunk = await importContacts({
          contacts: rows.slice(start, start + CHUNK_SIZE),
          ...(tags.length > 0 && { tags }),
          pending: importPending ? "unsubscribed" : "skip",
        });
        total.created += chunk.created;
        total.updated += chunk.updated;
        total.unchanged += chunk.unchanged;
        total.suppressed += chunk.suppressed;
        total.skipped.push(...chunk.skipped);
        setProgress(Math.round(((start + CHUNK_SIZE) / rows.length) * 100));
      }
    } catch (err) {
      setError(
        `${err instanceof ApiError ? err.message : "The import stopped"}. Rows before the failure were imported; importing the file again is safe.`,
      );
    }
    setResult(total);
    setStep("done");
    onImported();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (step === "importing") return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-4" />
        Import
      </Button>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV export from beehiiv, Mailchimp, Substack, Kit or any other
            tool. Unsubscribed, bounced and spam-complaint contacts stay that way, and
            nobody is re-subscribed.
          </DialogDescription>
        </DialogHeader>

        {error && <Banner>{error}</Banner>}

        {step === "pick" && (
          <div className="space-y-2">
            <Label htmlFor="import-file">CSV file</Label>
            <Input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => pickFile(event.target.files?.[0])}
            />
            <p className="text-sm text-muted-foreground">
              The first row must name the columns. One column has to hold the email
              address.
            </p>
          </div>
        )}

        {step === "map" && csv && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {csv.fileName}: {csv.rows.length.toLocaleString()} rows. Check how each
              column is imported.
            </p>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead>First value</TableHead>
                    <TableHead>Import as</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {csv.headers.map((header) => (
                    <TableRow key={header}>
                      <TableCell className="font-medium">{header}</TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">
                        {csv.rows.find((row) => row[header]?.trim())?.[header] ?? ""}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping[header]}
                          onValueChange={(field) =>
                            setMapping({
                              ...mapping,
                              [header]: field as ContactImportField,
                            })
                          }
                        >
                          <SelectTrigger
                            className="w-52"
                            aria-label={`Import ${header} as`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(FIELD_LABELS).map(([field, label]) => (
                              <SelectItem key={field} value={field}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {emailColumns !== 1 && (
              <p className="text-sm text-destructive">
                Choose exactly one column to import as Email.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="import-tags">Add tags to every contact (optional)</Label>
              <Input
                id="import-tags"
                value={tagsForAll}
                onChange={(event) => setTagsForAll(event.target.value)}
                placeholder="e.g. beehiiv, imported-2026-10"
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="import-pending"
                checked={importPending}
                onCheckedChange={(checked) => setImportPending(checked === true)}
              />
              <Label htmlFor="import-pending" className="leading-snug font-normal">
                <span>
                  Import contacts who never confirmed (Pending, Needs approval) as
                  unsubscribed, tagged &quot;pending&quot;. Otherwise they are skipped.
                </span>
              </Label>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="space-y-2">
            <p className="text-sm">Importing… keep this window open.</p>
            <Progress value={progress} />
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              {(
                [
                  ["Created", result.created],
                  ["Updated", result.updated],
                  ["Unchanged", result.unchanged],
                  ["Suppressed", result.suppressed],
                  ["Skipped", result.skipped.length],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-md border p-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold">{value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
            {result.skipped.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Why it was skipped</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.skipped.slice(0, 200).map((skipped) => (
                      <TableRow key={`${skipped.row}-${skipped.email}`}>
                        <TableCell>{skipped.row}</TableCell>
                        <TableCell>{skipped.email}</TableCell>
                        <TableCell>{SKIP_REASONS[skipped.reason]}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "map" && (
            <>
              <Button variant="outline" onClick={reset}>
                Choose another file
              </Button>
              <Button onClick={runImport} disabled={emailColumns !== 1}>
                Import {csv?.rows.length.toLocaleString()} contacts
              </Button>
            </>
          )}
          {step === "done" && (
            <Button
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
