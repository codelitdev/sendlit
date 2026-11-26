"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/codelit/badge";
import { IconButton } from "@/components/ui/codelit/icon-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type DnsRecordRow = {
  type: string;
  name: string;
  /** `null` when the value lives elsewhere; `missingValue` fills the cell. */
  value: string | null;
  purpose: string;
  present?: boolean;
};

/** DNS records to add, with copy buttons, and a note for DNS providers that
 * append the domain to the host themselves. */
export function DnsRecordsTable({
  records,
  domain,
  hostDetail,
  missingValue,
}: {
  records: DnsRecordRow[];
  domain: string;
  /** A muted line under the host, e.g. which DKIM key this is. */
  hostDetail?: (record: DnsRecordRow, index: number) => ReactNode;
  /** What the value cell shows for a record without a value. */
  missingValue?: ReactNode;
}) {
  const example = records.find((record) => record.name !== domain);
  return (
    <>
      {records.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-muted/40">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Type</TableHead>
                <TableHead className="px-4">Host</TableHead>
                <TableHead className="px-4">Value</TableHead>
                <TableHead className="px-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record, index) => (
                <TableRow
                  key={`${record.type}-${record.name}-${record.purpose}`}
                  className="align-top hover:bg-transparent"
                >
                  <TableCell className="whitespace-normal px-4 py-3">
                    <span className="rounded-md border bg-card px-2 py-1 font-mono text-xs">
                      {record.type}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal px-4 py-3">
                    <CopyableValue
                      value={record.name}
                      label={`Copy ${record.purpose} host`}
                    />
                    {hostDetail && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {hostDetail(record, index)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal px-4 py-3">
                    {record.value ? (
                      <CopyableValue
                        value={record.value}
                        label={`Copy ${record.purpose} value`}
                      />
                    ) : (
                      missingValue
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal px-4 py-3">
                    <Badge variant={record.present ? "success" : "outline"}>
                      {record.present ? "Found" : "Not found"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {records.some(
        (record) => record.name.endsWith(domain) && record.name !== domain,
      ) && (
        <p className="text-xs text-muted-foreground">
          Some DNS providers add <span className="font-mono">{domain}</span> to the host
          for you. If yours does, enter only the first part, like{" "}
          <span className="font-mono">{example?.name.replace(`.${domain}`, "")}</span>.
        </p>
      )}
    </>
  );
}

function CopyableValue({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="break-all font-mono text-xs leading-5">{value}</span>
      <CopyButton value={value} label={label} />
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      title={copied ? "Copied" : "Copy"}
      aria-label={label}
      className="-mt-0.5 shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}
