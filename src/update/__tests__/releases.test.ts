import {
  checkForUpdate,
  compareBuild,
  pickBuild,
  versionCodeFromAssetName,
  type UpdateCheck,
} from '../releases';

function release(over: Partial<Record<string, unknown>> = {}) {
  return {
    tag_name: 'build-46',
    name: 'Binocular 0.1.0+ci.46',
    html_url: 'https://github.com/jtn0123/binocular/releases/tag/build-46',
    draft: false,
    prerelease: true,
    body: 'notes here',
    assets: [
      {
        name: 'binocular-0.1.0-ci.46-vc1046.apk',
        size: 104_857_600,
        url: 'https://api.github.com/repos/jtn0123/binocular/releases/assets/1',
        browser_download_url: 'https://github.com/jtn0123/binocular/releases/download/build-46/x.apk',
      },
    ],
    ...over,
  };
}

function respond(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe('reading the version code off an asset name', () => {
  it('takes the counter Android actually compares', () => {
    // The marketing version cannot do this job: "0.1.0" never changes between
    // ad-hoc builds, and "0.1.0+ci.7" vs "0.1.0+ci.46" does not order as text.
    expect(versionCodeFromAssetName('binocular-0.1.0-ci.46-vc1046.apk')).toBe(1046);
    expect(versionCodeFromAssetName('binocular-0.2.0-vc2000.apk')).toBe(2000);
  });

  it('says null rather than guessing at a name it does not recognise', () => {
    expect(versionCodeFromAssetName('binocular.apk')).toBeNull();
    expect(versionCodeFromAssetName('binocular-vc.apk')).toBeNull();
    expect(versionCodeFromAssetName('notes-vc1046.txt')).toBeNull();
  });
});

describe('choosing which release to offer', () => {
  it('takes the newest one that has an APK on it', () => {
    const build = pickBuild([
      release({ tag_name: 'build-50', assets: [] }),
      release({ tag_name: 'build-46' }),
    ]);
    expect(build?.tag).toBe('build-46');
    expect(build?.versionCode).toBe(1046);
    expect(build?.asset.bytes).toBe(104_857_600);
  });

  it('offers pre-releases, because every ad-hoc build is one', () => {
    // Skipping them would mean the updater ignored the normal case — the
    // same reason the browser link points at /releases and not /releases/latest.
    const build = pickBuild([release({ prerelease: true })]);
    expect(build?.tag).toBe('build-46');
    expect(build?.prerelease).toBe(true);
  });

  it('skips drafts, which the phone cannot download anyway', () => {
    const build = pickBuild([release({ tag_name: 'draft', draft: true }), release()]);
    expect(build?.tag).toBe('build-46');
  });

  it('is null when nothing has an APK', () => {
    expect(pickBuild([release({ assets: [] })])).toBeNull();
    expect(pickBuild([])).toBeNull();
  });
});

describe('comparing against the running build', () => {
  it('orders by version code', () => {
    expect(compareBuild(1042, 1046)).toBe('newer');
    expect(compareBuild(1046, 1046)).toBe('current');
    expect(compareBuild(1046, 1042)).toBe('older');
  });

  it('says unknown when either side has no counter', () => {
    // A dev build has none. Reporting "up to date" there would be a
    // confident falsehood, which is the thing D5 exists to prevent.
    expect(compareBuild(null, 1046)).toBe('unknown');
    expect(compareBuild(1046, null)).toBe('unknown');
  });
});

describe('checking GitHub', () => {
  it('reports a newer build with its notes', async () => {
    const result = await checkForUpdate(1042, null, respond(200, [release()]));
    expect(result.state).toBe('newer');
    expect(result).toMatchObject({ build: { tag: 'build-46', notes: 'notes here' } });
  });

  it('asks for a token when an anonymous read is refused', async () => {
    // A private repository answers anonymously with 404, not 403 — GitHub
    // hides existence rather than admitting it. That is "you need a token",
    // not "no such repository".
    await expect(checkForUpdate(1042, null, respond(404, {}))).resolves.toEqual({
      state: 'needs-token',
    } satisfies UpdateCheck);
    await expect(checkForUpdate(1042, null, respond(403, {}))).resolves.toEqual({
      state: 'needs-token',
    } satisfies UpdateCheck);
  });

  it('blames the token once there is one', async () => {
    await expect(checkForUpdate(1042, 'ghp_x', respond(404, {}))).resolves.toEqual({
      state: 'bad-token',
    } satisfies UpdateCheck);
    await expect(checkForUpdate(1042, null, respond(401, {}))).resolves.toEqual({
      state: 'bad-token',
    } satisfies UpdateCheck);
  });

  it('is offline rather than broken when the request never lands', async () => {
    // Settings has to keep working in airplane mode (I4): "could not ask" is
    // information, not an error to recover from.
    const dead = (async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;
    await expect(checkForUpdate(1042, null, dead)).resolves.toEqual({
      state: 'offline',
    } satisfies UpdateCheck);
  });

  it('refuses a releases list that is not shaped like one', async () => {
    // D9: the boundary validates, so malformed JSON fails here rather than
    // as an undefined deep inside the settings screen.
    const result = await checkForUpdate(1042, null, respond(200, [{ tag_name: 42 }]));
    expect(result.state).toBe('failed');
  });

  it('tolerates fields GitHub adds later', async () => {
    const result = await checkForUpdate(1042, null, respond(200, [{ ...release(), brand_new: 1 }]));
    expect(result.state).toBe('newer');
  });

  it('sends the token only when there is one', async () => {
    const seen: (Record<string, string> | undefined)[] = [];
    const spy = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers);
      return { ok: true, status: 200, json: async () => [release()] } as unknown as Response;
    }) as unknown as typeof fetch;

    await checkForUpdate(1042, null, spy);
    await checkForUpdate(1042, 'ghp_secret', spy);
    expect(seen[0]?.Authorization).toBeUndefined();
    expect(seen[1]?.Authorization).toBe('Bearer ghp_secret');
  });
});
