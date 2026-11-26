import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const dataRoot = process.platform === 'win32'
  ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
const profilePath = join(dataRoot, 'PDF Tool', 'profile.json');

export async function readProfile() {
  try {
    return JSON.parse(await readFile(profilePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeProfile(items) {
  await mkdir(dirname(profilePath), { recursive: true, mode: 0o700 });
  const temp = profilePath + '.' + randomUUID();
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(items));
    } finally {
      await handle.close();
    }
    await rename(temp, profilePath);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function writeCopy(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
}


export async function replacePdf(path, bytes, originalDigest) {
  const target = await realpath(path);
  const temp = join(dirname(target), '.pdf-save-' + randomUUID());
  const { mode } = await stat(target);
  const handle = await open(temp, 'wx', mode & 0o777);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const current = createHash('sha256').update(await readFile(target)).digest('hex');
    if (current !== originalDigest) throw new Error('The original changed on disk. Reopen it before overwriting.');
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
}
