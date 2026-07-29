import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The root navigator against the files that actually exist.
 *
 * expo-router builds the route tree from the filesystem; `<Stack.Screen>` only
 * decorates a route that is already there. Naming one that is not is not an
 * error — it is a warning on every single launch, and the options you thought
 * you set silently apply to nothing. That is exactly what happened when the
 * map moved into `(tabs)` and the root stack kept declaring it.
 */
const APP = join(__dirname, '..', '..', '..', 'app');

/** Every route expo-router will build, as it names them. */
function routesOn(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) return [];
    if (entry.isDirectory()) {
      const nested = routesOn(join(dir, entry.name), `${prefix}${entry.name}/`);
      // A folder is itself a route name when it holds a layout — `(tabs)`.
      return [`${prefix}${entry.name}`, ...nested];
    }
    if (!/\.[jt]sx?$/.test(entry.name)) return [];
    return [`${prefix}${entry.name.replace(/\.[jt]sx?$/, '')}`];
  });
}

describe('the root navigator', () => {
  it('declares no screen that has no route', () => {
    const layout = readFileSync(join(APP, '_layout.tsx'), 'utf8');
    const declared = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);

    const real = new Set(routesOn(APP));
    const orphans = declared.filter((name) => !real.has(name));
    expect(orphans).toEqual([]);
  });

  it('hides its own header wherever a screen draws one', () => {
    // Bin detail draws the design's slim 54pt bar. If the stack's header came
    // back the screen would wear two — the navigator's 90pt slab above the
    // one the screen paints, with the title said twice.
    const layout = readFileSync(join(APP, '_layout.tsx'), 'utf8');
    const binScreen = /<Stack\.Screen\s+name="bin\/\[id\]"\s+options=\{\{([^}]*)\}\}/.exec(
      layout,
    );
    expect(binScreen?.[1]).toContain('headerShown: false');

    const tabs = readFileSync(join(APP, '(tabs)', '_layout.tsx'), 'utf8');
    expect(tabs).toContain('headerShown: false');
  });

  it('still routes the screens that moved into the tab group', () => {
    // `map` lives at app/(tabs)/map.tsx now. `/map` keeps working because a
    // route group is not part of the path — but the *root* stack must not
    // claim it, which is the distinction this pair pins down.
    const real = new Set(routesOn(APP));
    expect(real.has('(tabs)/map')).toBe(true);
    expect(real.has('map')).toBe(false);
  });
});
