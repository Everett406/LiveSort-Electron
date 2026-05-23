const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');

let mainWindow;
let pythonProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'LiveSort',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL('http://127.0.0.1:8000');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function waitForPort(port, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error('Python backend failed to start within timeout'));
        } else {
          setTimeout(check, 800);
        }
      });
      socket.connect(port, '127.0.0.1');
    };
    check();
  });
}

function findBackendExecutable() {
  const isPackaged = app.isPackaged;
  const platform = process.platform;

  if (isPackaged) {
    // In packaged app, look inside resources/bin (extraResources)
    const exeName = platform === 'win32' ? 'livesort-backend.exe' : 'livesort-backend';
    const bundled = path.join(process.resourcesPath, 'bin', exeName);
    if (fs.existsSync(bundled)) {
      return { cmd: bundled, cwd: path.dirname(bundled) };
    }
  }

  // Development fallback: system python
  const pythonCmd = platform === 'win32' ? 'python' : 'python3';
  const scriptPath = path.join(__dirname, '..', 'LiveSortApp', 'prod.py');
  const cwdPath = path.join(__dirname, '..', 'LiveSortApp');
  return { cmd: pythonCmd, args: [scriptPath], cwd: cwdPath };
}

app.whenReady().then(async () => {
  const backend = findBackendExecutable();
  const cwd = backend.cwd;

  console.log(`[Electron] Starting backend: ${backend.cmd} ${(backend.args || []).join(' ')}`);
  console.log(`[Electron] Backend CWD: ${cwd}`);

  const spawnOpts = {
    cwd: cwd,
    stdio: 'pipe',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  };

  pythonProcess = spawn(backend.cmd, backend.args || [], spawnOpts);

  let stderrBuffer = '';
  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python] ${data}`);
  });
  pythonProcess.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    console.error(`[Python] ${data}`);
  });

  pythonProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Python process exited with code ${code}`);
    }
  });

  try {
    await waitForPort(8000);
    createWindow();
  } catch (err) {
    dialog.showErrorBox(
      'LiveSort 启动失败',
      `无法启动后端服务。\n\n错误详情：${err.message}\n\n后端日志：${stderrBuffer.slice(-800)}`
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});
