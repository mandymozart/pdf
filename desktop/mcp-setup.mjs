import { app } from 'electron';
import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const variables = { ELECTRON_RUN_AS_NODE: '1' };
const script = app.isPackaged
  ? join(process.resourcesPath, 'app.asar', 'desktop', 'mcp.mjs')
  : fileURLToPath(new URL('./mcp.mjs', import.meta.url));
const command = process.execPath;

export function mcpConfig() {
  return JSON.stringify({ mcpServers: { pdf: { command, args: [script], env: variables } } }, null, 2);
}

async function clientExecutable(client) {
  const windows = process.platform === 'win32';
  const binary = windows ? client + '.exe' : client;
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  if (client === 'claude' && process.env.USERPROFILE) pathDirs.push(join(process.env.USERPROFILE, '.local', 'bin'));
  if (client === 'codex' && windows && process.env.LOCALAPPDATA) {
    const bin = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const folders = await readdir(bin, { withFileTypes: true }).catch(() => []);
    pathDirs.push(bin, ...folders.filter(entry => entry.isDirectory()).map(entry => join(bin, entry.name)));
  }
  for (const dir of pathDirs) {
    const candidate = join(dir, binary);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // A different PATH entry can have the executable.
    }
  }
  throw new Error(client + ' CLI was not found. Copy the configuration to set it up manually.');
}

export async function registerClient(client) {
  if (!['claude', 'codex'].includes(client)) throw new Error('Unknown MCP client.');
  const executable = await clientExecutable(client);
  const args = client === 'claude'
    ? ['mcp', 'add-json', '--scope', 'user', 'pdf', JSON.stringify(JSON.parse(mcpConfig()).mcpServers.pdf)]
    : ['mcp', 'add', 'pdf', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', command, script];
  try {
    await run(executable, args, { windowsHide: true, timeout: 20_000 });
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message);
  }
}
