import type { BlockSettingsProps } from "@/types/email-editor";
import type { ImageBlockSettings, UploadedImage, Uploader } from "./types";

export function ImageQuickEdit({
  block,
  updateBlock,
  uploader: UploaderComponent,
}: BlockSettingsProps<ImageBlockSettings> & { uploader?: Uploader }) {
  const merge = (image: Partial<UploadedImage>) =>
    updateBlock(block.id, { settings: { ...block.settings, ...image } });
  const label = block.settings.src ? "Change image" : "Choose image";
  const chooseButton = (
    <button
      type="button"
      className="sle-btn o"
      style={{ height: 30 }}
      onClick={
        UploaderComponent
          ? undefined
          : () => {
              const url = window.prompt("Enter image URL:", block.settings.src || "");
              if (url !== null) merge({ src: url });
            }
      }
    >
      {label}
    </button>
  );

  return (
    <>
      {UploaderComponent ? (
        <UploaderComponent value={block.settings as UploadedImage} onChange={merge}>
          {chooseButton}
        </UploaderComponent>
      ) : (
        chooseButton
      )}
      <input
        className="sle-in u"
        aria-label="Alt text"
        placeholder="Alt text: describe the image"
        value={block.settings.alt ?? ""}
        onChange={(event) => merge({ alt: event.target.value })}
      />
    </>
  );
}
