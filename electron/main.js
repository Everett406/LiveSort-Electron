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
    show: false,               // 先隐藏，等 ready-to-show 再显示，避免闪烁
    center: true,              // 确保窗口居中，防止屏幕外
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 等页面内容准备好再显示，避免白屏
  let shown = false;
  const doShow = () => {
    if (shown) return;
    shown = true;
    mainWindow.show();
    mainWindow.focus();
  };
  mainWindow.once('ready-to-show', doShow);
  // 保险：3 秒内如果 ready-to-show 没触发，也强制显示
  setTimeout(doShow, 3000);

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

function waitForPort(port, timeout = 60000, onProcessExit) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let resolved = false;

    const cleanup = () => { resolved = true; };

    const check = () => {
      if (resolved) return;

      // 如果后端进程已经退出，立刻失败，不再空等
      if (onProcessExit && onProcessExit.exited) {
        reject(new Error(
          `Python backend exited with code ${onProcessExit.code ?? 'null'} (signal: ${onProcessExit.signal ?? 'none'})`
        ));
        return;
      }

      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.once('connect', () => {
        if (resolved) return;
        cleanup();
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (resolved) return;
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

  let spawnErr = null;
  try {
    pythonProcess = spawn(backend.cmd, backend.args || [], spawnOpts);
  } catch (err) {
    spawnErr = err;
  }

  if (spawnErr || !pythonProcess) {
    logStream.write(`[Electron] Spawn error: ${spawnErr ? spawnErr.message : 'unknown'}\n`);
    dialog.showErrorBox(
      'LiveSort 启动失败',
      `无法启动后端进程。\n\n原因：${spawnErr ? spawnErr.message : 'unknown'}\n\n日志：${logFile}`
    );
    app.quit();
    return;
  }

  // 追踪进程退出状态，用于 waitForPort 中即时检测
  const procState = { exited: false, code: null, signal: null };

  let stderrBuffer = '';
  let stdoutBuffer = '';

  pythonProcess.stdout.on('data', (data) => {
    const line = String(data);
    stdoutBuffer += line;
    logStream.write(`[stdout] ${line}`);
    console.log(`[Python] ${line.trim()}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-log', line.trim());
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const line = String(data);
    stderrBuffer += line;
    logStream.write(`[stderr] ${line}`);
    console.error(`[Python] ${line.trim()}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-log', '[stderr] ' + line.trim());
    }
  });

  pythonProcess.on('error', (err) => {
    logStream.write(`[Electron] Process error: ${err.message}\n`);
    console.error('[Electron] Process error:', err);
  });

  pythonProcess.on('exit', (code, signal) => {
    procState.exited = true;
    procState.code = code;
    procState.signal = signal;
    logStream.write(`[Electron] Process exited code=${code} signal=${signal}\n`);
    logStream.write(`[Electron] stdout tail:\n${stdoutBuffer.slice(-2000)}\n`);
    logStream.write(`[Electron] stderr tail:\n${stderrBuffer.slice(-2000)}\n`);
    if (code !== 0 && code !== null) {
      console.error(`[Electron] Backend exited with code ${code}`);
    }
  });

  try {
    await waitForPort(8000, 300000, procState);  // 5 分钟超时，PyInstaller 后端启动可能很慢
    logStream.write('[Electron] Backend port 8000 is ready\n');
    loadMainApp();
  } catch (err) {
    logStream.write(`[Electron] Timeout waiting for port: ${err.message}\n`);
    logStream.end();

    const isCrash = procState.exited;
    const title = isCrash ? 'LiveSort 后端崩溃' : 'LiveSort 启动超时';
    const detail = isCrash
      ? `后端进程异常退出（exit code: ${procState.code ?? 'unknown'}）。\n可能原因：\n1. PyInstaller 打包的可执行文件缺少运行库\n2. Python 依赖缺失\n3. 杀毒软件拦截了后端进程`
      : `后端服务未能在 5 分钟内启动。\n可能原因：\n1. 后端可执行文件损坏\n2. 缺少运行库（如 VC++ Redistributable）\n3. 端口 8000 被占用\n4. 杀毒软件扫描导致启动极慢`;

    dialog.showErrorBox(
      title,
      `${detail}\n\n日志文件：${logFile}\n\n后端日志（最后 800 字）：\n${stderrBuffer.slice(-800)}\n${stdoutBuffer.slice(-800)}`
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
