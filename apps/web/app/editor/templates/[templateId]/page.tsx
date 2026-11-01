"use client";

import type { TemplatePurpose } from "@sendlit/api-contract";
import type { Email } from "@sendlit/email-editor";
import { use, useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { EmailEditorScreen } from "@/components/dashboard/email-editor-screen";
import { Loading } from "@/components/dashboard/loading";
import { Input } from "@/components/ui/codelit/input";
import { getTemplate, updateTemplate } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

export default function TemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = use(params);
  const [title, setTitle] = useState<string | null>(null);
  const [content, setContent] = useState<Email | null>(null);
  const [purpose, setPurpose] = useState<TemplatePurpose | null>(null);
  const [requiredVariables, setRequiredVariables] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTemplate(templateId)
      .then((template) => {
        setTitle(template.title);
        setContent(template.content);
        setPurpose(template.purpose);
        setRequiredVariables(template.requiredVariables);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load template"),
      );
  }, [templateId]);

  if (error) return <Banner>{error}</Banner>;
  if (title === null || content === null || purpose === null) return <Loading />;

  return (
    <EmailEditorScreen
      exitFallbackHref="/templates"
      saveLabel="Save template"
      initialContent={content}
      purpose={purpose}
      requiredVariables={requiredVariables}
      onSave={async (nextContent) => {
        const updated = await updateTemplate(templateId, {
          title,
          content: nextContent,
        });
        setRequiredVariables(updated.requiredVariables);
      }}
      title={
        <Input
          aria-label="Template title"
          className="max-w-sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Welcome email"
        />
      }
    />
  );
}
