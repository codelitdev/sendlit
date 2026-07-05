const path = require("node:path");

const GENERATED_DOCS_DIR = `${path.join("apps", "docs", ".source")}${path.sep}`;
const PRETTIER_EXTENSIONS = /\.(ts|tsx|js|mjs|css|md|json)$/;
const ESLINT_EXTENSIONS = /\.(ts|tsx)$/;

const quote = (file) => JSON.stringify(file);

module.exports = (files) => {
    const eligibleFiles = files.filter(
        (file) =>
            !path.relative(process.cwd(), file).startsWith(GENERATED_DOCS_DIR),
    );

    const prettierFiles = eligibleFiles.filter((file) =>
        PRETTIER_EXTENSIONS.test(file),
    );
    const eslintFiles = eligibleFiles.filter((file) =>
        ESLINT_EXTENSIONS.test(file),
    );

    return [
        prettierFiles.length > 0 &&
            `prettier --write --ignore-unknown ${prettierFiles.map(quote).join(" ")}`,
        eslintFiles.length > 0 &&
            `eslint --quiet --cache --fix ${eslintFiles.map(quote).join(" ")}`,
    ].filter(Boolean);
};
