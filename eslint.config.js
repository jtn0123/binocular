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
  {
    // Reanimated shared values look like refs to the React Compiler: they are
    // `{ value }` boxes written during a gesture, which `immutability` and
    // `refs` both read as mutating a ref outside an effect, and the gesture
    // object built from them cannot be memoized the way the compiler wants.
    // Writing them off the render path is the entire point — the drag ghost
    // tracks a finger on the UI thread and never waits for React.
    //
    // Scoped to the two files that own the map's drag. Anything that is not
    // driving a gesture should still obey these rules.
    files: ['src/map/useMapDrag.ts', 'src/components/map/BinCard.tsx'],
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  {
    // The map screen hands the drag's shared values to the ghost. It reads
    // none of them itself — it only passes them through — but a shared value
    // is a `{ value }` box, so the compiler counts the hand-off as reading a
    // ref during render. Narrowed to that one rule: the screen is still held
    // to the memoization and immutability rules.
    files: ['app/(tabs)/map.tsx'],
    rules: { 'react-hooks/refs': 'off' },
  },
]);
