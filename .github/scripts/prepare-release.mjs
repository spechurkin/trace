import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { load } from 'js-yaml';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function expectedAssets(version) {
  return [
    `Trace-${version}-windows-setup.exe`,
    `Trace-${version}-windows-portable.exe`,
    `Trace-${version}-mac-x64.dmg`,
    `Trace-${version}-mac-x64.zip`,
    `Trace-${version}-mac-arm64.dmg`,
    `Trace-${version}-mac-arm64.zip`,
    `Trace-${version}-linux-x86_64.AppImage`,
    `Trace-${version}-linux-amd64.deb`,
    `Trace-${version}-windows-setup.exe.blockmap`,
    'latest.yml',
    'latest-linux.yml',
  ].sort();
}

export async function prepareRelease(directory, version) {
  const expected = expectedAssets(version);
  const actual = (await readdir(directory)).filter((name) => name !== 'SHA256SUMS').sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Incomplete or unexpected release assets. Expected: ${expected.join(', ')}; found: ${actual.join(', ')}`,
    );
  }
  // Never publish a feed pointing at a missing, stale or corrupt installer.
  for (const [manifest, required] of [
    ['latest.yml', `Trace-${version}-windows-setup.exe`],
    ['latest-linux.yml', `Trace-${version}-linux-x86_64.AppImage`],
  ]) {
    const info = load(await readFile(path.join(directory, manifest), 'utf8'));
    if (
      info?.version !== version ||
      !Array.isArray(info.files) ||
      !info.files.some((file) => file.url === required)
    )
      throw new Error(`Invalid update manifest: ${manifest}`);
    for (const file of info.files) {
      if (
        !expected.includes(file.url) ||
        !/\.(exe|AppImage|deb)$/.test(file.url) ||
        (manifest === 'latest.yml'
          ? file.url !== required
          : !file.url.startsWith(`Trace-${version}-linux-`))
      )
        throw new Error(`Unexpected update target in ${manifest}`);
      const data = await readFile(path.join(directory, file.url));
      const digest = createHash('sha512').update(data).digest('base64');
      if (file.sha512 !== digest || file.size !== data.length)
        throw new Error(`Update checksum or size mismatch in ${manifest}: ${file.url}`);
    }
    if (info.path !== undefined) {
      const legacy = info.files.find((file) => file.url === info.path);
      if (!legacy || info.sha512 !== legacy.sha512)
        throw new Error(`Invalid legacy update target in ${manifest}`);
    }
  }
  const checksums = [];
  for (const name of expected) {
    const file = path.join(directory, name);
    const info = await stat(file);
    if (!info.isFile() || info.size === 0)
      throw new Error(`Empty or invalid release asset: ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    checksums.push(`${hash.digest('hex')}  ${name}`);
  }
  await writeFile(path.join(directory, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
  return [...expected, 'SHA256SUMS'];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.RELEASE_VERSION) throw new Error('RELEASE_VERSION is required.');
  const assets = await prepareRelease('release-assets', process.env.RELEASE_VERSION);
  console.log(`Validated ${assets.length - 1} release files and generated SHA256SUMS.`);
}
