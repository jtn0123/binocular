#!/usr/bin/env node
/**
 * Fails the build if a worklet captures a function from ordinary module scope.
 *
 * WHY THIS EXISTS
 *
 * The map's finger-drag killed the app *process* on the field-test phone, and
 * the cause was one line:
 *
 *   const chipStyle = useAnimatedStyle(() => ({
 *     transform: [{ translateY: dragY.value - CHIP_HEIGHT - sp(3) }],
 *   }));
 *
 * `sp` is `(n) => n * 4` from src/theme.ts — an ordinary function. A worklet
 * runs on a separate JS runtime, where a captured non-worklet function is
 * replaced by `remoteFunctionGuard`, whose entire body throws (see
 * node_modules/react-native-worklets/src/memory/remoteFunctionUnpacker.native.ts).
 * Reanimated's `mapperRun` is `try { … } finally { … }` with no `catch`, and
 * the runtime's own guard is compiled out of release builds:
 *
 *   #ifndef NDEBUG
 *     return callGuarded(function, …);
 *   #else
 *     return function.call(*runtime_, args...);   // release: nothing catches
 *   #endif
 *
 * So in debug it is a yellow LogBox warning and in a release APK it is an
 * uncaught C++ exception that aborts the process — invisible to the JS crash
 * handler, which is why diagnostics reported zero crashes throughout.
 *
 * Jest cannot catch this: the native layer is stubbed, so the whole 611-test
 * suite stayed green while the app was dying on the phone. Types cannot catch
 * it either — `sp(3)` is perfectly well typed. The only place it is visible is
 * the compiled bundle, where the Babel plugin records what each worklet
 * captured. That is what this reads.
 *
 * USAGE
 *   node scripts/ci/audit-worklet-closures.mjs <file.tsx> [...]
 *   node scripts/ci/audit-worklet-closures.mjs --self-test
 *
 * The --self-test mode runs the audit against a reconstruction of the line
 * that shipped, and fails if the audit does NOT flag it. A checker nobody has
 * seen fail is not a checker.
 */
import { parse } from '@babel/parser';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import process from 'node:process';

/**
 * Identifiers a worklet may legitimately capture.
 *
 * Shared values, plain data and the documented thread-hop helpers. Anything
 * else that is *called* inside a worklet is the bug this exists to find.
 */
const ALLOWED_CALLEES = new Set([
  'runOnJS',
  'runOnUI',
  'scheduleOnRN',
  'scheduleOnUI',
  'withTiming',
  'withSpring',
  'withDecay',
  'withDelay',
  'withSequence',
  'cancelAnimation',
  'measure',
  'interpolate',
  'interpolateColor',
  'clamp',
  'Math',
  'Number',
  'String',
  'Array',
  'Object',
  'JSON',
  'isNaN',
  'parseFloat',
  'parseInt',
]);

/** Where a worklet body begins, in the source we hand to Babel. */
const WORKLET_HOSTS = new Set([
  'useAnimatedStyle',
  'useAnimatedReaction',
  'useAnimatedProps',
  'useAnimatedScrollHandler',
  'useDerivedValue',
  'runOnUI',
  'onStart',
  'onUpdate',
  'onEnd',
  'onFinalize',
  'onBegin',
  'onTouchesDown',
  'onTouchesMove',
  'onTouchesUp',
]);

/**
 * Reads the SOURCE, not the compiled output.
 *
 * Deliberate: babel-preset-expo runs the worklets plugin, which rewrites the
 * worklet body before anything downstream can look at it — the call we care
 * about no longer appears as `useAnimatedStyle(() => …)`. Parsing the source
 * keeps the shape the author wrote, which is also the shape the error message
 * needs to point at.
 */
async function findViolations(code, filename) {
  const violations = [];
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      sourceFilename: filename,
    });
  } catch (err) {
    throw new Error(`could not parse ${filename}: ${err.message}`);
  }

  const { types: t } = await import('@babel/core');
  // @babel/traverse is CJS; under ESM the callable hides behind .default,
  // and in some versions behind .default.default.
  const traverseMod = await import('@babel/traverse');
  const traverse =
    typeof traverseMod.default === 'function' ? traverseMod.default : traverseMod.default.default;

  traverse(ast, {
    CallExpression(path) {
      const callee = path.get('callee');
      const hostName = callee.isIdentifier()
        ? callee.node.name
        : callee.isMemberExpression() && callee.get('property').isIdentifier()
          ? callee.node.property.name
          : null;
      if (!hostName || !WORKLET_HOSTS.has(hostName)) return;

      const body = path.get('arguments.0');
      if (!body || !(body.isArrowFunctionExpression() || body.isFunctionExpression())) return;

      body.traverse({
        CallExpression(inner) {
          const fn = inner.get('callee');
          if (!fn.isIdentifier()) return;
          const name = fn.node.name;
          if (ALLOWED_CALLEES.has(name)) return;

          // A function declared outside the worklet, and not itself marked as
          // a worklet, is the hazard.
          const binding = inner.scope.getBinding(name);
          if (!binding) return; // a global; not ours to police
          if (binding.scope.block === body.node) return; // defined inside
          if (isWorkletDeclaration(binding, t)) return;

          violations.push({
            file: filename,
            line: inner.node.loc?.start.line ?? 0,
            host: hostName,
            captured: name,
          });
        },
      });
    },
  });

  return violations;
}

/** Whether a binding resolves to something carrying the 'worklet' directive. */
function isWorkletDeclaration(binding, t) {
  const node = binding.path.node;
  const fn =
    t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)
      ? node
      : t.isVariableDeclarator(node) &&
          (t.isArrowFunctionExpression(node.init) || t.isFunctionExpression(node.init))
        ? node.init
        : null;
  if (!fn || !t.isBlockStatement(fn.body)) return false;
  return fn.body.directives?.some((d) => d.value.value === 'worklet') ?? false;
}

const SELF_TEST_SOURCE = `
import { useAnimatedStyle } from 'react-native-reanimated';
const sp = (n) => n * 4;
const CHIP_HEIGHT = 44;
export function Broken({ dragY }) {
  return useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value - CHIP_HEIGHT - sp(3) }],
  }));
}
`;

const SELF_TEST_FIXED = `
import { useAnimatedStyle } from 'react-native-reanimated';
const CHIP_LIFT = 12;
const CHIP_HEIGHT = 44;
export function Fixed({ dragY }) {
  return useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value - CHIP_HEIGHT - CHIP_LIFT }],
  }));
}
`;

async function selfTest() {
  const broken = await findViolations(SELF_TEST_SOURCE, 'self-test-broken.tsx');
  const fixed = await findViolations(SELF_TEST_FIXED, 'self-test-fixed.tsx');

  const caughtSp = broken.some((v) => v.captured === 'sp');
  if (!caughtSp) {
    console.error(
      'SELF-TEST FAILED: the audit did not flag `sp(3)` inside useAnimatedStyle —\n' +
        'the exact line that killed the process. The checker is not working.',
    );
    return 1;
  }
  if (fixed.length > 0) {
    console.error(
      'SELF-TEST FAILED: the audit flagged the corrected version, which hoists the\n' +
        `constant to module scope. False positives make it unusable. Got: ${JSON.stringify(fixed)}`,
    );
    return 1;
  }
  console.log('self-test passed: flags the shipped bug, passes the fix.');
  return 0;
}

/** Accepts files or directories; walks directories for .ts/.tsx. */
async function collect(target) {
  const info = await stat(target);
  if (!info.isDirectory()) return [target];
  const out = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(target, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(full)));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(await selfTest());

  if (args.length === 0) {
    console.error('usage: audit-worklet-closures.mjs <file...> | --self-test');
    process.exit(2);
  }

  // The audit must be able to fail before it is allowed to pass.
  if ((await selfTest()) !== 0) process.exit(1);

  const files = [];
  for (const arg of args) files.push(...(await collect(arg)));

  let violations = [];
  for (const file of files) {
    violations = violations.concat(await findViolations(await readFile(file, 'utf8'), file));
  }

  if (violations.length === 0) {
    console.log(`no worklet captured a non-worklet function (${files.length} file(s) checked).`);
    process.exit(0);
  }

  console.error('\nWorklet captures a non-worklet function — this aborts the process in release:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.host}(...) calls \`${v.captured}\``);
  }
  console.error(
    '\nOn the UI runtime a captured non-worklet becomes a stub that only throws,\n' +
      'and release builds compile out the guard that would catch it. Hoist the\n' +
      'value to a module-scope constant, or mark the function with the \'worklet\'\n' +
      'directive.\n',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
