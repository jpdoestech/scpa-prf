import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  host: { type: 'string', default: '127.0.0.1' },
  port: { type: 'string', default: '4173' },
  strictPort: { type: 'boolean' },
} });
await import('./build.mjs');
const child = spawn('python3', ['-m', 'http.server', '--bind', values.host, '--directory', 'dist', values.port], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 0; });
