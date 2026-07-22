const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'android/*', 'ios/*'],
  },
  {
    // Blueprint §6.1 contract idiom: each zod schema const shares its name
    // with the inferred type (`const Confidence` + `type Confidence`), which
    // this rule misreads as a redeclaration.
    files: ['src/vision/types.ts'],
    rules: { '@typescript-eslint/no-redeclare': 'off' },
  },
]);
