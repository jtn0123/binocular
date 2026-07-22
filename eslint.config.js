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
    // zod contract idiom: each schema const shares its name with the
    // inferred type (`const Confidence` + `type Confidence`), which this
    // rule misreads as a redeclaration (blueprint §6.1 and §7 payloads).
    files: ['src/vision/types.ts', 'src/qr/payload.ts'],
    rules: { '@typescript-eslint/no-redeclare': 'off' },
  },
]);
