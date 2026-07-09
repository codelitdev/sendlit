"use client";

import {
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
    type DragEvent,
} from "react";
import { ImageIcon, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api-client";
import { listMedia, type Media } from "@/lib/api";
import { useMediaLit } from "@/lib/use-medialit";
import { formatFileSize } from "@/lib/media-limits";
import { useMaxUploadSizeBytes } from "@/components/dashboard/max-upload-size-context";

interface SelectedImage {
    src: string;
    alt?: string;
}

interface UnsplashPhoto {
    id: string;
    alt_description?: string | null;
    description?: string | null;
    urls: {
        small: string;
        regular: string;
    };
    user?: {
        name?: string;
    };
}

interface EmailImageUploadDialogProps {
    acceptedMimeTypes?: string[];
    disabled?: boolean;
    onSelect: (image: SelectedImage) => void;
    open: boolean;
    setOpen: (value: boolean) => void;
    children: React.ReactNode;
}

function getUploadedImageSrc(media: Record<string, string>) {
    return media.file || media.url || media.src || media.original || "";
}

export function EmailImageUploadDialog({
    acceptedMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"],
    disabled = false,
    onSelect,
    open,
    setOpen,
    children,
}: EmailImageUploadDialogProps) {
    const [activeTab, setActiveTab] = useState("upload");
    const [file, setFile] = useState<File | null>(null);
    const [caption, setCaption] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [fileError, setFileError] = useState("");
    const [uploadError, setUploadError] = useState("");
    const [mediaItems, setMediaItems] = useState<Media[]>([]);
    const [mediaQuery, setMediaQuery] = useState("");
    const [mediaError, setMediaError] = useState("");
    const [loadingMedia, setLoadingMedia] = useState(false);
    const [unsplashUrl, setUnsplashUrl] = useState("");
    const [unsplashAlt, setUnsplashAlt] = useState("");
    const [unsplashQuery, setUnsplashQuery] = useState("");
    const [unsplashResults, setUnsplashResults] = useState<UnsplashPhoto[]>([]);
    const [loadingUnsplash, setLoadingUnsplash] = useState(false);
    const [unsplashError, setUnsplashError] = useState("");
    const unsplashAccessKey = process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY;
    const maxUploadSizeBytes = useMaxUploadSizeBytes();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { isUploading, uploadProgress, uploadFile, cancelUpload } =
        useMediaLit({
            signatureEndpoint: "/api/proxy/media/presigned",
            access: "public",
            onUploadError: (error) => {
                setUploadError(error.message || "Failed to upload image");
            },
        });

    const resetState = () => {
        setFile(null);
        setCaption("");
        setFileError("");
        setUploadError("");
        setIsDragging(false);
        setMediaError("");
        setUnsplashError("");
        setLoadingUnsplash(false);
        setOpen(false);
    };

    const isValidMimeType = (mimeType: string) =>
        mimeType.startsWith("image/") &&
        (acceptedMimeTypes.length === 0 ||
            acceptedMimeTypes.includes(mimeType));

    const handleFileValidation = (selectedFile: File) => {
        if (!isValidMimeType(selectedFile.type)) {
            setFileError("Only image files are supported.");
            setFile(null);
            return;
        }

        if (selectedFile.size > maxUploadSizeBytes) {
            setFileError(
                `Image is too large. Maximum size is ${formatFileSize(maxUploadSizeBytes)}.`,
            );
            setFile(null);
            return;
        }

        setFileError("");
        setUploadError("");
        setFile(selectedFile);
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => setIsDragging(false);

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        const droppedFile = event.dataTransfer.files[0];
        if (droppedFile) {
            handleFileValidation(droppedFile);
        }
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        event.target.value = "";
        if (selectedFile) {
            handleFileValidation(selectedFile);
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setUploadError("");
        const media = await uploadFile(file, {
            caption: caption || "",
            type: "email-image",
        });
        const src = getUploadedImageSrc(media);
        if (!src) {
            setUploadError("Upload completed without an image URL");
            return;
        }
        onSelect({ src, alt: caption || file.name });
        resetState();
    };

    const loadMedia = async () => {
        setLoadingMedia(true);
        setMediaError("");
        try {
            const result = await listMedia({
                query: mediaQuery || undefined,
                pageSize: 30,
            });
            setMediaItems(result.items);
        } catch (error) {
            setMediaError(
                error instanceof ApiError
                    ? error.message
                    : "Failed to load media",
            );
        } finally {
            setLoadingMedia(false);
        }
    };

    const selectMedia = (item: Media) => {
        onSelect({
            src: item.url,
            alt: item.alt || item.caption || item.fileName || "Image",
        });
        resetState();
    };

    const selectUnsplashImage = () => {
        const trimmedUrl = unsplashUrl.trim();
        if (!trimmedUrl) {
            setUnsplashError("Enter an Unsplash image URL");
            return;
        }
        try {
            const parsed = new URL(trimmedUrl);
            if (!parsed.hostname.includes("unsplash.com")) {
                setUnsplashError("Enter a valid Unsplash URL");
                return;
            }
        } catch {
            setUnsplashError("Enter a valid Unsplash URL");
            return;
        }

        onSelect({
            src: trimmedUrl,
            alt: unsplashAlt.trim() || "Unsplash image",
        });
        setUnsplashUrl("");
        setUnsplashAlt("");
        resetState();
    };

    const searchUnsplash = async () => {
        if (!unsplashAccessKey) {
            setUnsplashError("Unsplash search is not configured");
            return;
        }
        const query = unsplashQuery.trim();
        if (!query) {
            setUnsplashError("Enter a search term");
            return;
        }

        setLoadingUnsplash(true);
        setUnsplashError("");
        try {
            const params = new URLSearchParams({
                query,
                per_page: "12",
                client_id: unsplashAccessKey,
            });
            const response = await fetch(
                `https://api.unsplash.com/search/photos?${params}`,
            );
            if (!response.ok) {
                throw new Error("Failed to search Unsplash");
            }
            const data = (await response.json()) as {
                results?: UnsplashPhoto[];
            };
            setUnsplashResults(data.results || []);
        } catch (error) {
            setUnsplashError(
                error instanceof Error
                    ? error.message
                    : "Failed to search Unsplash",
            );
        } finally {
            setLoadingUnsplash(false);
        }
    };

    const selectUnsplashPhoto = (photo: UnsplashPhoto) => {
        onSelect({
            src: photo.urls.regular,
            alt: photo.alt_description || photo.description || "Unsplash image",
        });
        resetState();
    };

    useEffect(() => {
        if (open && activeTab === "media") {
            void loadMedia();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, activeTab]);

    const acceptAttribute =
        acceptedMimeTypes.length > 0 ? acceptedMimeTypes.join(",") : undefined;

    return (
        <Dialog
            open={open}
            onOpenChange={(value) => {
                if (isUploading) return;
                if (value) {
                    setOpen(true);
                } else {
                    resetState();
                }
            }}
        >
            <DialogTrigger asChild disabled={disabled}>
                {children}
            </DialogTrigger>

            <DialogContent className="max-w-2xl" showCloseButton={!isUploading}>
                <DialogHeader>
                    <DialogTitle>Select Image</DialogTitle>
                    <DialogDescription>
                        Upload or choose an image for this email.
                    </DialogDescription>
                </DialogHeader>

                <Tabs
                    defaultValue="upload"
                    value={activeTab}
                    onValueChange={setActiveTab}
                >
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="upload">Upload</TabsTrigger>
                        <TabsTrigger value="media">Your Media</TabsTrigger>
                        <TabsTrigger value="unsplash">Unsplash</TabsTrigger>
                    </TabsList>

                    <TabsContent value="upload" className="space-y-4 py-4">
                        <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-all duration-200 ${
                                isDragging
                                    ? "border-primary bg-primary/5"
                                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                            } ${file ? "bg-primary/5" : ""} ${
                                fileError
                                    ? "border-destructive bg-destructive/5"
                                    : ""
                            }`}
                            style={{
                                pointerEvents: isUploading ? "none" : "auto",
                            }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                onChange={handleFileChange}
                                className="hidden"
                                disabled={isUploading}
                                accept={acceptAttribute}
                            />
                            <Upload
                                className={`mb-2 h-6 w-6 ${
                                    fileError
                                        ? "text-destructive"
                                        : isDragging || file
                                          ? "text-primary"
                                          : "text-muted-foreground"
                                }`}
                            />
                            <p
                                className={`text-sm font-medium ${
                                    fileError
                                        ? "text-destructive"
                                        : isDragging || file
                                          ? "text-primary"
                                          : "text-muted-foreground"
                                }`}
                            >
                                {file ? file.name : "Drop image here or click"}
                            </p>
                            {!file && !fileError ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Images only, up to{" "}
                                    {formatFileSize(maxUploadSizeBytes)}
                                </p>
                            ) : null}
                            {file && !fileError ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Selected: {formatFileSize(file.size)}
                                </p>
                            ) : null}
                            {fileError ? (
                                <p className="mt-2 text-xs text-destructive">
                                    {fileError}
                                </p>
                            ) : null}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="email-image-caption">
                                Caption (optional)
                            </Label>
                            <Input
                                id="email-image-caption"
                                placeholder="Add a caption to your image"
                                value={caption}
                                onChange={(event) =>
                                    setCaption(event.target.value)
                                }
                                disabled={isUploading}
                            />
                        </div>

                        {uploadError ? (
                            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                                {uploadError}
                            </p>
                        ) : null}

                        {isUploading ? (
                            <div className="space-y-3 rounded-lg border border-muted bg-muted/30 p-4">
                                <div className="flex items-start gap-3">
                                    <Upload className="mt-1 h-5 w-5 text-primary" />
                                    <div>
                                        <p className="text-sm font-medium">
                                            {file?.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {Math.round(uploadProgress)}%
                                        </p>
                                    </div>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-muted">
                                    <div
                                        className="h-full rounded-full bg-primary transition-all"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </TabsContent>

                    <TabsContent value="media" className="space-y-4 py-4">
                        <div className="flex gap-2">
                            <Input
                                placeholder="Search media"
                                value={mediaQuery}
                                onChange={(event) =>
                                    setMediaQuery(event.target.value)
                                }
                            />
                            <Button
                                type="button"
                                variant="outline"
                                onClick={loadMedia}
                                disabled={loadingMedia}
                            >
                                <Search className="size-4" />
                            </Button>
                        </div>

                        {mediaError ? (
                            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                                {mediaError}
                            </p>
                        ) : null}

                        {loadingMedia ? (
                            <div className="grid grid-cols-3 gap-3">
                                {Array.from({ length: 6 }).map((_, index) => (
                                    <div
                                        key={index}
                                        className="aspect-square rounded-md bg-muted"
                                    />
                                ))}
                            </div>
                        ) : mediaItems.length ? (
                            <div className="grid max-h-80 grid-cols-3 gap-3 overflow-y-auto pr-1">
                                {mediaItems.map((item) => (
                                    <button
                                        key={item.mediaId}
                                        type="button"
                                        className="group overflow-hidden rounded-md border bg-background text-left transition-colors hover:border-primary"
                                        onClick={() => selectMedia(item)}
                                    >
                                        <div className="aspect-square bg-muted">
                                            <img
                                                src={
                                                    item.thumbnailUrl ||
                                                    item.url
                                                }
                                                alt={
                                                    item.alt ||
                                                    item.fileName ||
                                                    "Media"
                                                }
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                        <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">
                                            {item.alt ||
                                                item.caption ||
                                                item.fileName ||
                                                "Image"}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed text-muted-foreground">
                                <ImageIcon className="mb-2 size-6" />
                                <p className="text-sm">No media found</p>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="unsplash" className="space-y-4 py-4">
                        {unsplashAccessKey ? (
                            <>
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="Search Unsplash"
                                        value={unsplashQuery}
                                        onChange={(event) =>
                                            setUnsplashQuery(event.target.value)
                                        }
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={searchUnsplash}
                                        disabled={loadingUnsplash}
                                    >
                                        <Search className="size-4" />
                                    </Button>
                                </div>

                                {loadingUnsplash ? (
                                    <div className="grid grid-cols-3 gap-3">
                                        {Array.from({ length: 6 }).map(
                                            (_, index) => (
                                                <div
                                                    key={index}
                                                    className="aspect-square rounded-md bg-muted"
                                                />
                                            ),
                                        )}
                                    </div>
                                ) : unsplashResults.length ? (
                                    <div className="grid max-h-80 grid-cols-3 gap-3 overflow-y-auto pr-1">
                                        {unsplashResults.map((photo) => (
                                            <button
                                                key={photo.id}
                                                type="button"
                                                className="group overflow-hidden rounded-md border bg-background text-left transition-colors hover:border-primary"
                                                onClick={() =>
                                                    selectUnsplashPhoto(photo)
                                                }
                                            >
                                                <div className="aspect-square bg-muted">
                                                    <img
                                                        src={photo.urls.small}
                                                        alt={
                                                            photo.alt_description ||
                                                            "Unsplash"
                                                        }
                                                        className="h-full w-full object-cover"
                                                    />
                                                </div>
                                                <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">
                                                    {photo.user?.name ||
                                                        "Unsplash"}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="unsplash-url">
                                        Unsplash URL
                                    </Label>
                                    <Input
                                        id="unsplash-url"
                                        placeholder="https://images.unsplash.com/..."
                                        value={unsplashUrl}
                                        onChange={(event) => {
                                            setUnsplashUrl(event.target.value);
                                            setUnsplashError("");
                                        }}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="unsplash-alt">
                                        Alt text
                                    </Label>
                                    <Input
                                        id="unsplash-alt"
                                        placeholder="Describe the image"
                                        value={unsplashAlt}
                                        onChange={(event) =>
                                            setUnsplashAlt(event.target.value)
                                        }
                                    />
                                </div>
                            </>
                        )}
                        {unsplashError ? (
                            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                                {unsplashError}
                            </p>
                        ) : null}
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    {isUploading ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={cancelUpload}
                            disabled={Math.round(uploadProgress) > 99}
                        >
                            {Math.round(uploadProgress) > 99
                                ? "Processing..."
                                : "Cancel"}
                        </Button>
                    ) : activeTab === "upload" ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={resetState}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                disabled={!file || !!fileError}
                                onClick={handleUpload}
                            >
                                Upload
                            </Button>
                        </>
                    ) : activeTab === "unsplash" && !unsplashAccessKey ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={resetState}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                disabled={!unsplashUrl.trim()}
                                onClick={selectUnsplashImage}
                            >
                                Insert
                            </Button>
                        </>
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={resetState}
                        >
                            Close
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
