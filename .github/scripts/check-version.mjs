import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function checkVersion(pkg, lock, refType, refName) {
  const versionPattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;
  const match = versionPattern.exec(pkg.version);
  if (!match || match[4]?.split('.').some((part) => /^0\d+$/.test(part))) {
    throw new Error(`Invalid application version: ${pkg.version}`);
  }
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error('package.json and package-lock.json must have the same version.');
  }
  if (refType === 'tag' && refName !== `v${pkg.version}`) {
    throw new Error(`Release tag ${refName} must match package version v${pkg.version}.`);
  }
  return pkg.version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const version = checkVersion(pkg, lock, process.env.GITHUB_REF_TYPE, process.env.GITHUB_REF_NAME);
  console.log(`Validated application version: ${version}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  }
}
