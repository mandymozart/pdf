const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pdfTool', {
  onOpen: callback => {
    const listener = (_event, name, bytes, path) => callback(name, bytes, path);
    ipcRenderer.on('pdf:opened', listener);
    ipcRenderer.send('pdf:ready');
    return () => ipcRenderer.removeListener('pdf:opened', listener);
  },
  windowAction: action => ipcRenderer.send('window:action', action),
  onMaximized: callback => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
  mcpConfig: () => ipcRenderer.invoke('mcp:config'),
  copyMcpConfig: () => ipcRenderer.invoke('mcp:copy-config'),
  registerMcp: client => ipcRenderer.invoke('mcp:register', client),
  readProfile: () => ipcRenderer.invoke('profile:read'),
  writeProfile: items => ipcRenderer.invoke('profile:write', items),
  filePath: file => webUtils.getPathForFile(file),
  overwritePdf: (path, bytes, digest) => ipcRenderer.invoke('pdf:overwrite', path, bytes, digest),
  savePdf: (bytes, name) => ipcRenderer.invoke('pdf:save', bytes, name),
});

