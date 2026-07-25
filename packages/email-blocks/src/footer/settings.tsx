"use client";

import type { BlockSettingsProps } from "@sendlit/email-editor";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../components/ui/select";
import type { FooterLabels, FooterSettings } from "./types";

function updateSettings(
    props: BlockSettingsProps<FooterSettings>,
    patch: Partial<FooterSettings>,
) {
    props.updateBlock(props.block.id, {
        settings: { ...props.block.settings, ...patch },
    });
}

export function FooterSettingsPanel(
    props: BlockSettingsProps<FooterSettings> & { labels: FooterLabels },
) {
    const { labels, block } = props;

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>{labels.alignment}</Label>
                <Select
                    value={block.settings.alignment ?? "center"}
                    onValueChange={(alignment) =>
                        updateSettings(props, {
                            alignment: alignment as FooterSettings["alignment"],
                        })
                    }
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="left">
                            {labels.alignmentLeft}
                        </SelectItem>
                        <SelectItem value="center">
                            {labels.alignmentCenter}
                        </SelectItem>
                        <SelectItem value="right">
                            {labels.alignmentRight}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                    <Label>{labels.foregroundColor}</Label>
                    <Input
                        type="color"
                        value={block.settings.foregroundColor ?? "#64748b"}
                        onChange={(event) =>
                            updateSettings(props, {
                                foregroundColor: event.target
                                    .value as `#${string}`,
                            })
                        }
                    />
                </div>
                <div className="space-y-2">
                    <Label>{labels.backgroundColor}</Label>
                    <Input
                        type="color"
                        value={
                            block.settings.backgroundColor === "transparent" ||
                            !block.settings.backgroundColor
                                ? "#ffffff"
                                : block.settings.backgroundColor
                        }
                        onChange={(event) =>
                            updateSettings(props, {
                                backgroundColor: event.target
                                    .value as `#${string}`,
                            })
                        }
                    />
                </div>
            </div>

            {(
                [
                    ["fontSize", labels.fontSize, "12"],
                    ["paddingTop", labels.paddingTop, "16"],
                    ["paddingBottom", labels.paddingBottom, "16"],
                    ["paddingX", labels.paddingX, "24"],
                ] as const
            ).map(([key, label, fallback]) => (
                <div className="space-y-2" key={key}>
                    <Label htmlFor={`footer-${key}`}>{label}</Label>
                    <Input
                        id={`footer-${key}`}
                        type="number"
                        min="0"
                        value={Number.parseInt(
                            block.settings[key] ?? fallback,
                            10,
                        )}
                        onChange={(event) =>
                            updateSettings(props, {
                                [key]: `${Math.max(0, Number(event.target.value) || 0)}px`,
                            })
                        }
                    />
                </div>
            ))}
        </div>
    );
}
