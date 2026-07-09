async function getMediaLitClient() {
    const { MediaLit } = await import("medialit");

    return new MediaLit({
        apiKey: process.env.MEDIALIT_APIKEY,
        endpoint: process.env.MEDIALIT_SERVER,
    });
}

export async function getMediaUploadSignature(group: string): Promise<{
    signature: string;
    endpoint: string;
}> {
    const medialit = await getMediaLitClient();
    const signature = await medialit.getSignature({ group });

    return {
        signature,
        endpoint: medialit.endpoint,
    };
}

export async function sealMedia(
    mediaId: string,
): Promise<Record<string, string>> {
    const medialit = await getMediaLitClient();
    return (await medialit.seal(mediaId)) as unknown as Record<string, string>;
}

export async function deleteMedia(mediaId: string) {
    const medialit = await getMediaLitClient();
    await medialit.delete(mediaId);
}
