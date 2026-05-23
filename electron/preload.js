const { contextBridge } = require('electron');

// 目前不需要暴露额外 API，前端保持纯 Web 体验
// 后续如需文件系统访问，可在此安全暴露
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform
});
