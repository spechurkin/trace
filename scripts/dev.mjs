import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import './build-electron.mjs';

const server = await createServer();
await server.listen();
const env = { ...process.env, TRACE_DEV_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: true });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
child.on('error', async (error) => {
  console.error(error);
  await server.close();
  process.exit(1);
});
process.on('SIGINT', () => child.kill());
