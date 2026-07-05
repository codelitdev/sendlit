const { defineConfig, globalIgnores } = require("eslint/config");

const globals = require("globals");
const nextCoreWebVitals = require("eslint-config-next/core-web-vitals");
const prettier = require("eslint-config-prettier");
const react = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
const tseslint = require("typescript-eslint");
const unusedImports = require("eslint-plugin-unused-imports");

const nextConfigs = nextCoreWebVitals.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{js,jsx,ts,tsx}", "apps/docs/**/*.{js,jsx,ts,tsx}"],
    settings: {
        ...(config.settings ?? {}),
        react: {
            version: "detect",
        },
        next: {
            ...((config.settings ?? {}).next ?? {}),
            rootDir: ["apps/web/", "apps/docs/"],
        },
    },
}));

module.exports = defineConfig([
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
                ecmaVersion: "latest",
                sourceType: "module",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint.plugin,
        },
    },
    {
        files: ["**/*.{js,mjs,cjs,ts,tsx}"],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.jest,
            },
        },

        plugins: {
            "unused-imports": unusedImports,
        },

        rules: {
            "no-console": [
                "error",
                {
                    allow: ["warn", "error"],
                },
            ],

            "unused-imports/no-unused-imports": "error",
            "@typescript-eslint/ban-ts-comment": "off",
        },
    },
    {
        files: [
            "packages/email-editor/**/*.{js,jsx,ts,tsx}",
            "packages/email-blocks/**/*.{js,jsx,ts,tsx}",
        ],
        plugins: {
            "@typescript-eslint": tseslint.plugin,
            react,
            "react-hooks": reactHooks,
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            ...react.configs.recommended.rules,
            "react/react-in-jsx-scope": "off",
            "react-hooks/rules-of-hooks": "error",
            "@typescript-eslint/no-explicit-any": "warn",
            "react/display-name": "off",
        },
    },
    ...nextConfigs,
    {
        files: [
            "apps/web/**/*.{js,jsx,ts,tsx}",
            "apps/docs/**/*.{js,jsx,ts,tsx}",
        ],
        rules: {
            "react-hooks/set-state-in-effect": "off",
        },
    },
    prettier,
    globalIgnores([
        "**/node_modules/",
        "**/.next/",
        "**/.source/",
        "**/dist/",
        "**/out/",
        "packages/email-editor/src/components/ui/**",
        "packages/email-blocks/src/components/ui/**",
    ]),
]);
