import { source } from "@/lib/source";
import { getLLMText } from "@/lib/get-llm-text";

export const revalidate = false;

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ slug: string[] }> },
) {
    const { slug } = await params;
    const normalizedSlug =
        slug.length === 1 && slug[0] === "index" ? undefined : slug;
    const page = source.getPage(normalizedSlug);

    if (!page) {
        return new Response("Not Found", { status: 404 });
    }

    return new Response(await getLLMText(page), {
        headers: {
            "Content-Type": "text/markdown; charset=utf-8",
        },
    });
}

export function generateStaticParams() {
    return source.generateParams().map((item: { slug?: string[] }) => ({
        slug: item.slug?.length ? item.slug : ["index"],
    }));
}
