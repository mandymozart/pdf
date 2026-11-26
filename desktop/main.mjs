import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session } from 'electron';
import { basename, extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { readProfile, replacePdf, writeCopy, writeProfile } from './storage.mjs';
import { mcpConfig, registerClient } from './mcp-setup.mjs';

protocol.registerSchemesAsPrivileged([
  { scheme: 'localpdf', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const home = 'localpdf://local/';
const root = fileURLToPath(new URL('../dist', import.meta.url));

function fromApp(event) {
  if (!event.senderFrame?.url.startsWith(home)) throw new Error('Unexpected sender.');
}

ipcMain.handle('profile:read', event => {
  fromApp(event);
  return readProfile();
});
ipcMain.handle('profile:write', (event, items) => {
  fromApp(event);
  return writeProfile(items);
});
ipcMain.handle('pdf:save', async (event, bytes, name) => {
  fromApp(event);
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Save signed copy',
    defaultPath: basename(name),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled) return null;
  try {
    await writeCopy(result.filePath, bytes);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('That file already exists. Choose a new name.');
    throw error;
  }
  return result.filePath;
});

ipcMain.handle('pdf:overwrite', async (event, path, bytes, originalDigest) => {
  fromApp(event);
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.pdf' || !/^[a-f0-9]{64}$/.test(originalDigest)) {
    throw new Error('The original PDF must be open from a local file.');
  }
  const window = BrowserWindow.fromWebContents(event.sender);
  const choice = await dialog.showMessageBox(window, {
    type: 'question', buttons: ['Cancel', 'Replace file'], defaultId: 0, cancelId: 0,
    message: 'Replace the original PDF?', detail: path,
  });
  if (choice.response !== 1) return false;
  await replacePdf(path, bytes, originalDigest);
  return true;
});

let mainWindow;
let rendererReady = false;

function pdfArgument(args, cwd) {
  const path = args.find(arg => !arg.startsWith('-') && extname(arg).toLowerCase() === '.pdf');
  return path ? resolve(cwd, path) : null;
}

let pendingPath = pdfArgument(process.argv.slice(app.isPackaged ? 1 : 2), process.cwd());

async function deliverPdf(path) {
  if (!path) return;
  if (!rendererReady || !mainWindow) {
    pendingPath = path;
    return;
  }
  const window = mainWindow;
  try {
    const bytes = await readFile(path);
    if (!window.isDestroyed()) window.webContents.send('pdf:opened', basename(path), bytes, path);
  } catch (error) {
    if (!window.isDestroyed()) await dialog.showMessageBox(window, {
      type: 'error', message: 'Could not open this PDF.', detail: error.message,
    });
  }
}

ipcMain.on('pdf:ready', event => {
  fromApp(event);
  if (event.sender !== mainWindow?.webContents) return;
  rendererReady = true;
  const path = pendingPath;
  pendingPath = null;
  void deliverPdf(path);
});

ipcMain.handle('mcp:config', event => {
  fromApp(event);
  return mcpConfig();
});
ipcMain.handle('mcp:copy-config', event => {
  fromApp(event);
  clipboard.writeText(mcpConfig());
});
ipcMain.handle('mcp:register', (event, client) => {
  fromApp(event);
  return registerClient(client);
});

ipcMain.on('window:action', (event, action) => {
  fromApp(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (action === 'minimize') window.minimize();
  if (action === 'maximize') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }
  if (action === 'close') window.close();
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1150, height: 900, minWidth: 480, minHeight: 540,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: fileURLToPath(new URL('preload.cjs', import.meta.url)),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow = window;
  rendererReady = false;
  window.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });
  const reportWindowState = () => window.webContents.send('window:maximized', window.isMaximized());
  window.on('maximize', reportWindowState);
  window.on('unmaximize', reportWindowState);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadURL(home);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, args, cwd) => {
    if (!mainWindow && app.isReady()) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
    void deliverPdf(pdfArgument(args.slice(app.isPackaged ? 1 : 2), cwd));
  });
  app.on('open-file', (event, path) => {
    event.preventDefault();
    void deliverPdf(path);
  });
  app.whenReady().then(start);
}

function start() {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  protocol.handle('localpdf', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'local') return new Response(null, { status: 404 });
    const file = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + sep)) return new Response(null, { status: 404 });
    if (file.endsWith('.mjs') || file.endsWith('.wasm')) {
      try {
        const contentType = file.endsWith('.mjs') ? 'text/javascript' : 'application/wasm';
        return new Response(await readFile(file), { headers: { 'Content-Type': contentType } });
      } catch {
        return new Response(null, { status: 404 });
      }
    }
    return net.fetch(pathToFileURL(file).href);
  });
  createWindow();
}
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });


