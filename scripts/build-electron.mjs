import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  absWorkingDir: root,
  tsconfig: path.join(root, 'tsconfig.json'),
  entryPoints: [path.join(root, 'electron/main.ts'), path.join(root, 'electron/preload.ts')],
  outdir: path.join(root, 'dist-electron'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
});
