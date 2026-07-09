"use client";

import { useEffect, useRef, useState } from "react";
import { Upload as TUSUpload, type UploadOptions } from "tus-js-client";

interface UseMediaLitProps {
    signatureEndpoint: string;
    access: "public" | "private";
    chunkSize?: number;
    onUploadComplete?: (media: Record<string, string>) => void;
    onUploadError?: (error: Error) => void;
}

export function useMediaLit({
    signatureEndpoint,
    access,
    chunkSize,
    onUploadComplete,
    onUploadError,
}: UseMediaLitProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [file, setFile] = useState<File | null>(null);
    const uploadRef = useRef<TUSUpload | null>(null);

    const getSignature = async (): Promise<{
        signature?: string;
        endpoint?: string;
    }> => {
        const res = await fetch(signatureEndpoint, { method: "POST" });
        if (!res.ok) return {};
        return res.json();
    };

    const uploadFile = (
        fileToUpload: File,
        metadata: Record<string, string> = {},
    ): Promise<Record<string, string>> => {
        setFile(fileToUpload);
        setIsUploading(true);
        setUploadProgress(0);

        return new Promise<Record<string, string>>((resolve, reject) => {
            getSignature()
                .then(({ signature, endpoint }) => {
                    if (!signature || !endpoint) {
                        const err = new Error("Failed to obtain signature");
                        setIsUploading(false);
                        onUploadError?.(err);
                        reject(err);
                        return;
                    }

                    const tusOptions: UploadOptions = {
                        endpoint: `${endpoint}/media/create/resumable`,
                        removeFingerprintOnSuccess: true,
                        retryDelays: [0, 3000, 5000],
                        headers: {
                            "x-medialit-signature": signature,
                        },
                        metadata: {
                            fileName: fileToUpload.name,
                            mimeType: fileToUpload.type,
                            access,
                            ...metadata,
                        },
                        onProgress: (bytesUploaded, bytesTotal) => {
                            setUploadProgress(
                                (bytesUploaded / bytesTotal) * 100,
                            );
                        },
                        onError: (error) => {
                            setIsUploading(false);
                            onUploadError?.(error);
                            reject(error);
                        },
                        onSuccess: (payload) => {
                            try {
                                const mediaString =
                                    payload.lastResponse.getHeader("Media");
                                const media: Record<string, string> | null =
                                    mediaString
                                        ? JSON.parse(mediaString)
                                        : null;
                                if (!media) {
                                    throw new Error(
                                        "Upload completed without media metadata",
                                    );
                                }
                                delete media.group;
                                onUploadComplete?.(media);
                                resolve(media);
                                setUploadProgress(100);
                            } catch (error) {
                                const uploadError =
                                    error instanceof Error
                                        ? error
                                        : new Error("Failed to parse media");
                                onUploadError?.(uploadError);
                                reject(uploadError);
                            } finally {
                                setIsUploading(false);
                                setFile(null);
                            }
                        },
                    };
                    if (chunkSize) {
                        tusOptions.chunkSize = chunkSize;
                    }

                    const upload = new TUSUpload(fileToUpload, tusOptions);
                    uploadRef.current = upload;
                    upload.findPreviousUploads().then((previousUploads) => {
                        if (previousUploads.length) {
                            upload.resumeFromPreviousUpload(previousUploads[0]);
                        }
                        upload.start();
                    });
                })
                .catch((error) => {
                    setIsUploading(false);
                    onUploadError?.(error);
                    reject(error);
                });
        });
    };

    const cancelUpload = () => {
        uploadRef.current?.abort();
        uploadRef.current = null;
        setIsUploading(false);
    };

    useEffect(() => cancelUpload, []);

    return {
        file,
        isUploading,
        uploadProgress,
        uploadFile,
        cancelUpload,
    };
}
