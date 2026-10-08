import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
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
  console.log(`Validated ${assets.length - 1} packages and generated SHA256SUMS.`);
}
