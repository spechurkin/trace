import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareRelease } from './prepare-release.mjs';

export async function publishRelease({
                                       github,
                                       context,
                                       core,
                                       version,
                                       directory = 'release-assets',
                                     }) {
  const tag = `v${version}`;
  if (
    context.ref !== `refs/tags/${tag}` ||
    !['push', 'workflow_dispatch'].includes(context.eventName)
  ) {
    throw new Error('Releases can only be published from a matching version tag.');
  }
  const names = await prepareRelease(directory, version);
  const repo = context.repo;
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...repo,
    per_page: 100,
  });
  let release = releases.find((item) => item.tag_name === tag);
  if (release && !release.draft) {
    core.info(`Release ${tag} is already published; its assets are preserved.`);
    return release;
  }
  const prerelease = version.split('+')[0].includes('-');
  if (!release) {
    ({ data: release } = await github.rest.repos.createRelease({
      ...repo,
      tag_name: tag,
      target_commitish: context.sha,
      name: `Trace ${version}`,
      body: 'Windows: setup or portable EXE. macOS: choose x64 (Intel) or arm64 (Apple Silicon). Linux: AppImage or DEB. SHA256SUMS contains SHA-256 checksums for every package.\n\nBuilds are unsigned; macOS builds are not notarized.',
      draft: true,
      prerelease,
      generate_release_notes: true,
    }));
  }
  core.info(`Uploading ${names.length} assets to draft ${tag} (${release.id}).`);
  const existingAssets = await github.paginate(github.rest.repos.listReleaseAssets, {
    ...repo,
    release_id: release.id,
    per_page: 100,
  });
  for (const name of names) {
    const data = await readFile(path.join(directory, name));
    const digest = `sha256:${createHash('sha256').update(data).digest('hex')}`;
    const existing = existingAssets.find((asset) => asset.name === name);
    if (
      existing?.state === 'uploaded' &&
      existing.size === data.length &&
      existing.digest === digest
    ) {
      core.info(`Verified existing asset: ${name}`);
      continue;
    }
    if (existing) {
      await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: existing.id });
    }
    const { data: uploaded } = await github.rest.repos.uploadReleaseAsset({
      ...repo,
      release_id: release.id,
      name,
      data,
      headers: { 'content-type': 'application/octet-stream', 'content-length': data.length },
    });
    if (
      uploaded.state !== 'uploaded' ||
      uploaded.size !== data.length ||
      (uploaded.digest && uploaded.digest !== digest)
    ) {
      throw new Error(`Release asset failed verification: ${name}. Release remains a draft.`);
    }
  }
  const { data: published } = await github.rest.repos.updateRelease({
    ...repo,
    release_id: release.id,
    draft: false,
    prerelease,
    make_latest: prerelease ? 'false' : 'legacy',
  });
  core.info(`Published ${published.html_url}`);
  await core.summary
    .addHeading(`Trace ${version}`)
    .addLink('Download release', published.html_url)
    .addRaw(`\n\nPublished ${names.length - 1} packages and SHA256SUMS.\n`)
    .write();
  return published;
}
