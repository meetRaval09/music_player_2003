const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  close: () => ipcRenderer.send('w:close'),
  min: () => ipcRenderer.send('w:min'),
  fit: (h) => ipcRenderer.send('w:fit', h),
  playing: (on) => ipcRenderer.send('w:playing', !!on),
  pin: () => ipcRenderer.invoke('w:pin'),
  getPin: () => ipcRenderer.invoke('w:getPin'),
});
