import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '..');

export function loadConfig() {
  return {
    host: process.env.REF_SERVER_HOST ?? '127.0.0.1',
    port: Number(process.env.REF_SERVER_PORT ?? 5050),
    dbPath:
      process.env.REF_SERVER_DB_PATH ??
      resolve(projectRoot, 'data', 'reference-stack.sqlite'),
  };
}
