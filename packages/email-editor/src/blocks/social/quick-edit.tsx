import type { BlockSettingsProps } from "@/types/email-editor";
import { SOCIAL_NETWORKS, type SocialBlockSettings, type SocialLink } from "./types";

/** One row per network: tick it to show it, then give its link. */
export function SocialQuickEdit({
  block,
  updateBlock,
}: BlockSettingsProps<SocialBlockSettings>) {
  const links = block.settings.links ?? [];
  const setLinks = (next: SocialLink[]) =>
    updateBlock(block.id, { settings: { ...block.settings, links: next } });

  return (
    <div className="rows">
      {SOCIAL_NETWORKS.map((network) => {
        const link = links.find((item) => item.network === network.value);
        return (
          <label key={network.value}>
            <input
              type="checkbox"
              checked={Boolean(link)}
              onChange={(event) =>
                setLinks(
                  event.target.checked
                    ? [...links, { network: network.value, url: "" }]
                    : links.filter((item) => item.network !== network.value),
                )
              }
            />
            <span>{network.label}</span>
            <input
              className="sle-in mono"
              aria-label={`${network.label} link`}
              placeholder="https://"
              disabled={!link}
              value={link?.url ?? ""}
              onChange={(event) =>
                setLinks(
                  links.map((item) =>
                    item.network === network.value
                      ? { ...item, url: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
        );
      })}
    </div>
  );
}
