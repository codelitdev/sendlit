const configuredItemsPerPage = Number(process.env.ITEMS_PER_PAGE);

export const ITEMS_PER_PAGE =
    Number.isInteger(configuredItemsPerPage) && configuredItemsPerPage > 0
        ? Math.min(configuredItemsPerPage, 50)
        : 10;
