const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

let mainWindow;
let pythonProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'LiveSort',
    icon: path.join(__dirname, '..', 'LiveSortApp', 'static', 'livesort-brand-icon.png'),
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

function findPython() {
  if (process.platform === 'win32') {
    return 'python';
  }
  return 'python3';
}

app.whenReady().then(async () => {
  const pythonCmd = findPython();
  const scriptPath = path.join(__dirname, '..', 'LiveSortApp', 'prod.py');
  const cwdPath = path.join(__dirname, '..', 'LiveSortApp');

  pythonProcess = spawn(pythonCmd, [scriptPath], {
    cwd: cwdPath,
    stdio: 'pipe',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

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
      `无法启动 Python 后端服务。请确保已安装 Python 3.9+ 并配置了环境变量。\n\n错误详情：${err.message}\n\n后端日志：${stderrBuffer.slice(-500)}`
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
