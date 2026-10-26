const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tradeGunluguDesktop', {
  getVersion: () => ipcRenderer.invoke('trade-gunlugu:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('trade-gunlugu:check-updates'),
  onUpdateProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('trade-gunlugu:update-progress', listener);
    return () => ipcRenderer.removeListener('trade-gunlugu:update-progress', listener);
  },
  chatgptNewsState: () => ipcRenderer.invoke('trade-gunlugu:chatgpt-news-state'),
  chatgptNewsSignIn: (action) => ipcRenderer.invoke('trade-gunlugu:chatgpt-news-sign-in', action),
  chatgptNewsDisconnect: () => ipcRenderer.invoke('trade-gunlugu:chatgpt-news-disconnect'),
  chatgptNewsOpenUsage: () => ipcRenderer.invoke('trade-gunlugu:chatgpt-news-open-usage'),
  chatgptNewsSaveSettings: (settings) => ipcRenderer.invoke('trade-gunlugu:chatgpt-news-save-settings', settings),
  chatgptNewsEvaluate: (id) => ipcRenderer.invoke('trade-gunlugu:chatgpt-news-evaluate', id),
});
