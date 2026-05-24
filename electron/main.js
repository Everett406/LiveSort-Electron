const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');
const os = require('os');

let mainWindow;
let pythonProcess;

function getLogPath() {
  const logDir = path.join(os.tmpdir(), 'livesort-logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
  return path.join(logDir, `backend-${Date.now()}.log`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'LiveSort',
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Show loading screen immediately
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function loadMainApp() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL('http://127.0.0.1:8000');
  }
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
    const exeName = platform === 'win32' ? 'livesort-backend.exe' : 'livesort-backend';
    const bundled = path.join(process.resourcesPath, 'bin', 'livesort-backend', exeName);
    if (fs.existsSync(bundled)) {
      return { cmd: bundled, cwd: path.dirname(bundled), source: 'bundled' };
    }
    const bundledFlat = path.join(process.resourcesPath, 'bin', exeName);
    if (fs.existsSync(bundledFlat)) {
      return { cmd: bundledFlat, cwd: path.dirname(bundledFlat), source: 'bundled-flat' };
    }
  }

  const pythonCmd = platform === 'win32' ? 'python' : 'python3';
  const scriptPath = path.join(__dirname, '..', 'LiveSortApp', 'prod.py');
  const cwdPath = path.join(__dirname, '..', 'LiveSortApp');
  return { cmd: pythonCmd, args: [scriptPath], cwd: cwdPath, source: 'python-dev' };
}

app.whenReady().then(async () => {
  // Create window immediately so user sees something
  createWindow();

  const backend = findBackendExecutable();
  const logFile = getLogPath();
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  logStream.write(`[Electron] Backend source: ${backend.source}\n`);
  logStream.write(`[Electron] Backend cmd: ${backend.cmd}\n`);
  logStream.write(`[Electron] Backend args: ${JSON.stringify(backend.args || [])}\n`);
  logStream.write(`[Electron] Backend cwd: ${backend.cwd}\n`);
  logStream.write(`[Electron] resourcesPath: ${process.resourcesPath}\n`);
  logStream.write(`[Electron] __dirname: ${__dirname}\n`);

  const spawnOpts = {
    cwd: backend.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  };

  console.log(`[Electron] Starting backend: ${backend.cmd}`);
  console.log(`[Electron] Backend source: ${backend.source}`);

  try {
    pythonProcess = spawn(backend.cmd, backend.args || [], spawnOpts);
  } catch (spawnErr) {
    logStream.write(`[Electron] Spawn error: ${spawnErr.message}\n`);
    dialog.showErrorBox(
      'LiveSort 启动失败',
      `无法启动后端进程。\n\n原因：${spawnErr.message}\n\n日志：${logFile}`
    );
    app.quit();
    return;
  }

  let stderrBuffer = '';

  pythonProcess.stdout.on('data', (data) => {
    const line = String(data);
    logStream.write(`[stdout] ${line}`);
    console.log(`[Python] ${line.trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    const line = String(data);
    stderrBuffer += line;
    logStream.write(`[stderr] ${line}`);
    console.error(`[Python] ${line.trim()}`);
  });

  pythonProcess.on('error', (err) => {
    logStream.write(`[Electron] Process error: ${err.message}\n`);
    console.error('[Electron] Process error:', err);
  });

  pythonProcess.on('exit', (code, signal) => {
    logStream.write(`[Electron] Process exited code=${code} signal=${signal}\n`);
    if (code !== 0 && code !== null) {
      console.error(`[Electron] Backend exited with code ${code}`);
    }
  });

  try {
    await waitForPort(8000);
    logStream.write('[Electron] Backend port 8000 is ready\n');
    loadMainApp();
  } catch (err) {
    logStream.write(`[Electron] Timeout waiting for port: ${err.message}\n`);
    logStream.write(`[Electron] stderr tail:\n${stderrBuffer.slice(-2000)}\n`);
    logStream.end();

    dialog.showErrorBox(
      'LiveSort 启动失败',
      `后端服务未能在 60 秒内启动。\n\n可能原因：\n1. 后端可执行文件损坏\n2. 缺少运行库（如 VC++ Redistributable）\n3. 端口 8000 被占用\n\n日志文件：${logFile}\n\n错误详情：${err.message}\n\n后端日志（最后 500 字）：\n${stderrBuffer.slice(-500)}`
    );
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      loadMainApp();
    }
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
