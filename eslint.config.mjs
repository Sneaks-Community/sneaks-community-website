import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginImportX from "eslint-plugin-import-x";
import pluginUnicorn from "eslint-plugin-unicorn";
import pluginPromise from "eslint-plugin-promise";
import pluginSecurity from "eslint-plugin-security";

export default tseslint.config(
  eslint.configs.recommended,
  pluginSecurity.configs.recommended,

  {
    ignores: ["dist/**", "node_modules/**", "public/lib/**"],
  },

  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "import-x": pluginImportX,
      unicorn: pluginUnicorn,
      promise: pluginPromise,
    },
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    rules: {
      "no-unused-vars": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { "checksVoidReturn": { "arguments": false } }
      ],

      "import-x/no-unresolved": [
        "error",
        { ignore: ["^\\.\\/.+\\.js$"] },
      ],
      "import-x/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", ["parent", "sibling"], "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      "promise/catch-or-return": "error",
      "promise/always-return": "warn",

      "unicorn/prefer-node-protocol": "error",
      "unicorn/no-await-expression-member": "warn",
      "unicorn/prevent-abbreviations": [
        "error",
        { "allowList": { "req": true, "res": true, "next": true, "LogFnFields": true } }
      ],

      "no-console": "error",
    },
  },

  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2023,
        Motion: "readonly",
        // Shared helpers defined in common.js and consumed by the page scripts.
        prefersReducedMotion: "readonly",
        updateDiscordWidget: "readonly",
      },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      "eqeqeq": "error",
      "curly": ["error", "all"],
      "no-undef": "error",
    },
  },
);
