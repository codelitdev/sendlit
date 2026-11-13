"use client";

import { TagManager } from "@sendlit/email-blocks";
import Link from "next/link";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { Loading } from "@/components/dashboard/loading";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { deleteTag, getTagReferences, listTags, renameTag } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

export default function TagsPage() {
  useSetBreadcrumb([{ label: "Contacts", href: "/contacts" }, { label: "Tags" }]);

  return (
    <ScrollablePage>
      <PageHeader
        title="Tags"
        description="Every tag your contacts carry. Rename a tag to fix it everywhere it's used, or delete one you no longer need."
      />
      <TagManager
        listTags={listTags}
        getTagReferences={getTagReferences}
        renameTag={renameTag}
        deleteTag={deleteTag}
        sequenceHref={(sequence) =>
          `/${sequence.type === "broadcast" ? "broadcasts" : "sequences"}/${sequence.sequenceId}`
        }
        linkComponent={Link}
        loadingIndicator={<Loading className="p-6" />}
        errorMessage={(error, fallback) =>
          error instanceof ApiError ? error.message : fallback
        }
      />
    </ScrollablePage>
  );
}
