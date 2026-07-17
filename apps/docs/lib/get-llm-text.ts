/** The documentation source combines MDX and generated OpenAPI pages. */
export async function getLLMText(page: any) {
    if (page.data.type === "openapi") {
        return JSON.stringify(page.data.getSchema().bundled, null, 2);
    }

    const processed = await page.data.getText("processed");

    return `# ${page.data.title} (${page.url})\n\n${processed}`;
}
