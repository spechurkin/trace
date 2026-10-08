import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkVersion } from './check-version.mjs';
import { expectedAssets, prepareRelease } from './prepare-release.mjs';
import { publishRelease } from './publish-release.mjs';

const version = '1.2.3';
const portableName = `Trace-${version}-windows-portable.exe`;
const context = {
  ref: `refs/tags/v${version}`,
  eventName: 'push',
  sha: 'release-commit',
  repo: { owner: 'example', repo: 'trace' },
};

async function assetFixture(t, releaseVersion = version) {
  const parent = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(parent, 'clubs-ci-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), parent);
    await rm(directory, { recursive: true, force: true });
  });
  // Use names emitted by electron-builder, independently of the validation list.
  const builtAssets = [
    `Trace-${releaseVersion}-windows-setup.exe`,
    `Trace-${releaseVersion}-windows-portable.exe`,
    `Trace-${releaseVersion}-mac-x64.dmg`,
    `Trace-${releaseVersion}-mac-x64.zip`,
    `Trace-${releaseVersion}-mac-arm64.dmg`,
    `Trace-${releaseVersion}-mac-arm64.zip`,
    `Trace-${releaseVersion}-linux-x86_64.AppImage`,
    `Trace-${releaseVersion}-linux-amd64.deb`,
  ];
  for (const name of builtAssets) {
    await writeFile(path.join(directory, name), `test package: ${name}`);
  }
  return directory;
}

function apiFixture({ releases = [], assets = [], failUpload, corruptUpload } = {}) {
  const calls = [];
  const repos = {};
  repos.listReleases = Symbol('listReleases');
  repos.listReleaseAssets = Symbol('listReleaseAssets');
  for (const method of [
    'createRelease',
    'deleteReleaseAsset',
    'uploadReleaseAsset',
    'updateRelease',
  ]) {
    repos[method] = async (args) => {
      calls.push({ method, args });
      if (method === 'uploadReleaseAsset') {
        if (args.name === failUpload) throw new Error('Upload interrupted');
        return {
          data: {
            state: 'uploaded',
            size: args.data.length,
            digest:
              args.name === corruptUpload
                ? 'sha256:invalid'
                : `sha256:${createHash('sha256').update(args.data).digest('hex')}`,
          },
        };
      }
      return {
        data: { id: 42, html_url: 'https://github.com/example/clubs/releases/tag/v1.2.3', ...args },
      };
    };
  }
  const github = {
    rest: { repos },
    paginate: async (method) => {
      calls.push({ method: 'paginate' });
      return method === repos.listReleases ? releases : assets;
    },
  };
  const summary = {
    addHeading() {
      return this;
    },
    addLink() {
      return this;
    },
    addRaw() {
      return this;
    },
    async write() {
    },
  };
  return {
    github, core: {
      info() {
      }, summary,
    }, calls,
  };
}

test('validates matching package, lockfile and stable or prerelease tags', () => {
  for (const value of ['0.1.0', version, '2.0.0-beta.1', '2.0.0-rc.0+build-12']) {
    const lock = { version: value, packages: { '': { version: value } } };
    assert.equal(checkVersion({ version: value }, lock, 'tag', `v${value}`), value);
    assert.equal(checkVersion({ version: value }, lock, 'branch', 'main'), value);
  }
});

test('rejects invalid versions and mismatched tags or lockfile versions', () => {
  const lock = { version, packages: { '': { version } } };
  assert.throws(() => checkVersion({ version }, lock, 'tag', 'v9.0.0'), /must match/);
  assert.throws(() => checkVersion({ version }, { ...lock, version: '9.0.0' }), /same version/);
  assert.throws(
    () => checkVersion({ version }, { ...lock, packages: { '': { version: '9.0.0' } } }),
    /same version/,
  );
  for (const value of ['1.2', '01.2.3', '1.2.3-beta.01', '1.2.3\ninjected=value', 'latest']) {
    assert.throws(() => checkVersion({ version: value }, lock), /Invalid application version/);
  }
});

test('writes independently verifiable checksums for all eight packages', async (t) => {
  const directory = await assetFixture(t);
  const names = await prepareRelease(directory, version);
  assert.equal(names.length, 9);
  const lines = (await readFile(path.join(directory, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 8);
  for (const line of lines) {
    const [digest, name] = line.split('  ');
    const data = await readFile(path.join(directory, name));
    assert.equal(digest, createHash('sha256').update(data).digest('hex'));
  }
  assert.deepEqual(await prepareRelease(directory, version), names);
});

test('rejects missing, empty and unexpected distribution files', async (t) => {
  const directory = await assetFixture(t);
  const file = path.join(directory, portableName);
  await rm(file);
  await assert.rejects(prepareRelease(directory, version), /Incomplete/);
  await writeFile(file, '');
  await assert.rejects(prepareRelease(directory, version), /Empty/);
  await writeFile(file, 'portable');
  await writeFile(path.join(directory, 'builder-debug.yml'), 'internal');
  await assert.rejects(prepareRelease(directory, version), /unexpected/);
});

test('creates a draft and publishes only after every upload is verified', async (t) => {
  const directory = await assetFixture(t);
  const api = apiFixture();
  await publishRelease({ ...api, context, version, directory });
  const mutations = api.calls.filter((call) => call.method !== 'paginate');
  assert.equal(mutations[0].method, 'createRelease');
  assert.equal(mutations[0].args.draft, true);
  assert.equal(mutations[0].args.generate_release_notes, true);
  assert.equal(mutations.filter((call) => call.method === 'uploadReleaseAsset').length, 9);
  assert.equal(mutations.at(-1).method, 'updateRelease');
  assert.equal(mutations.at(-1).args.draft, false);
  assert.equal(mutations.at(-1).args.prerelease, false);
});

test('upload failures and incorrect upload digests leave the release unpublished', async (t) => {
  const directory = await assetFixture(t);
  for (const options of [{ failUpload: portableName }, { corruptUpload: portableName }]) {
    const api = apiFixture(options);
    await assert.rejects(
      publishRelease({ ...api, context, version, directory }),
      /Upload interrupted|failed verification/,
    );
    assert.equal(
      api.calls.some((call) => call.method === 'updateRelease'),
      false,
    );
  }
});

test('resumes a draft, reuses matching assets and replaces incomplete assets', async (t) => {
  const directory = await assetFixture(t);
  const name = expectedAssets(version)[0];
  const data = await readFile(path.join(directory, name));
  const api = apiFixture({
    releases: [{ id: 42, tag_name: `v${version}`, draft: true }],
    assets: [
      {
        id: 1,
        name,
        size: data.length,
        state: 'uploaded',
        digest: `sha256:${createHash('sha256').update(data).digest('hex')}`,
      },
      { id: 2, name: portableName, size: 0, state: 'starter' },
    ],
  });
  await publishRelease({ ...api, context, version, directory });
  assert.equal(
    api.calls.some((call) => call.method === 'createRelease'),
    false,
  );
  assert.equal(api.calls.filter((call) => call.method === 'uploadReleaseAsset').length, 8);
  assert.equal(api.calls.find((call) => call.method === 'deleteReleaseAsset').args.asset_id, 2);
});

test('preserves already published releases on a rerun', async (t) => {
  const directory = await assetFixture(t);
  const release = { id: 42, tag_name: `v${version}`, draft: false };
  const api = apiFixture({ releases: [release] });
  assert.equal(await publishRelease({ ...api, context, version, directory }), release);
  assert.equal(api.calls.filter((call) => call.method !== 'paginate').length, 0);
});

test('rejects branch or pull request publication and missing packages before API calls', async (t) => {
  const directory = await assetFixture(t);
  const api = apiFixture();
  for (const invalidContext of [
    { ...context, ref: 'refs/heads/main' },
    { ...context, eventName: 'pull_request' },
  ]) {
    await assert.rejects(
      publishRelease({ ...api, context: invalidContext, version, directory }),
      /matching version tag/,
    );
  }
  await rm(path.join(directory, portableName));
  await assert.rejects(publishRelease({ ...api, context, version, directory }), /Incomplete/);
  assert.equal(api.calls.length, 0);
});

test('publishes prerelease versions without marking them as the latest release', async (t) => {
  const prereleaseVersion = '2.0.0-beta.1';
  const directory = await assetFixture(t, prereleaseVersion);
  const api = apiFixture();
  await publishRelease({
    ...api,
    context: { ...context, ref: `refs/tags/v${prereleaseVersion}`, eventName: 'workflow_dispatch' },
    version: prereleaseVersion,
    directory,
  });
  const update = api.calls.find((call) => call.method === 'updateRelease');
  assert.equal(update.args.prerelease, true);
  assert.equal(update.args.make_latest, 'false');
});
