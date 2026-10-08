import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const executable = path.resolve(process.argv[2] || 'release/Trace/win-unpacked/Trace.exe');
if (!existsSync(executable)) throw new Error(`Packaged application missing: ${executable}`);
const env = { ...process.env, TRACE_TEST_EXECUTABLE: executable };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
  stdio: 'inherit',
  windowsHide: true,
  env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
