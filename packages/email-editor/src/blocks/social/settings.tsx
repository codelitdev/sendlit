import { Plus, Trash2 } from "lucide-react";
import { SettingsColorPicker } from "@/components/settings/settings-color-picker";
import { SettingsInput } from "@/components/settings/settings-input";
import { SettingsSelect } from "@/components/settings/settings-select";
import { Button } from "@/components/ui/button";
import type { BlockSettingsProps } from "@/types/email-editor";
import { SOCIAL_NETWORKS, type SocialBlockSettings, type SocialLink } from "./types";

export function SocialSettings({
  block,
  updateBlock,
}: BlockSettingsProps<SocialBlockSettings>) {
  const links = block.settings.links ?? [];
  const set = (key: string, value: unknown) =>
    updateBlock(block.id, { settings: { ...block.settings, [key]: value } });
  const setLinks = (next: SocialLink[]) => set("links", next);
  const unused = SOCIAL_NETWORKS.find(
    (network) => !links.some((link) => link.network === network.value),
  );

  return (
    <div className="space-y-4">
      {links.map((link, index) => (
        // Each network can be used once, so it identifies its row.
        <div key={link.network} className="space-y-2 border-b pb-4">
          <SettingsSelect
            label={`Network ${index + 1}`}
            value={link.network}
            onChange={(value) =>
              setLinks(
                links.map((item, i) =>
                  i === index
                    ? { ...item, network: value as SocialLink["network"] }
                    : item,
                ),
              )
            }
            options={SOCIAL_NETWORKS.filter(
              (n) =>
                n.value === link.network ||
                !links.some((other) => other.network === n.value),
            ).map((n) => ({ value: n.value, label: n.label }))}
          />
          <SettingsInput
            label={`${SOCIAL_NETWORKS.find((n) => n.value === link.network)?.label ?? "Social"} link`}
            value={link.url}
            placeholder="https://"
            onChange={(value) =>
              setLinks(
                links.map((item, i) => (i === index ? { ...item, url: value } : item)),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLinks(links.filter((_, i) => i !== index))}
          >
            <Trash2 className="mr-1 h-3 w-3" /> Remove
          </Button>
        </div>
      ))}
      {unused && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLinks([...links, { network: unused.value, url: "" }])}
        >
          <Plus className="mr-1 h-3 w-3" /> Add a link
        </Button>
      )}
      <SettingsSelect
        label="Alignment"
        value={block.settings.alignment || "center"}
        onChange={(value) => set("alignment", value)}
        options={[
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ]}
        defaultValue="center"
      />
      <SettingsColorPicker
        label="Background Color"
        value={block.settings.backgroundColor || "transparent"}
        onChange={(value) => set("backgroundColor", value)}
        defaultValue="transparent"
      />
    </div>
  );
}
