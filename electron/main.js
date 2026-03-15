const { app, BrowserWindow, Tray, Menu, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let tray;
let serverProcess;
let isVisible = true;

const isDev = process.env.NODE_ENV !== 'production';
const DEV_URL = 'http://localhost:5179';
const SERVER_PORT = 3001;

app.setName('Pai');
if (process.platform === 'win32') {
  app.setAppUserModelId('Pai');
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
  const { x: workX, y: workY } = primaryDisplay.workArea;

  const winWidth = 420;

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: screenH,
    x: workX + screenW - winWidth,
    y: workY,
    minWidth: 340,
    minHeight: 400,
    title: 'Pai',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#0a0a0f',
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    show: false,
    resizable: true,
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    isVisible = true;
  });

  // Hide instead of close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  isVisible = true;
  // Focus the chat input
  mainWindow.webContents.executeJavaScript(`
    setTimeout(() => {
      const input = document.querySelector('.quick-add-input') || document.querySelector('.chat-input-bar textarea');
      if (input) input.focus();
    }, 150);
  `).catch(() => {});
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
  isVisible = false;
}

function toggleWindow() {
  if (isVisible) hideWindow();
  else showWindow();
}

// Pop up and FORCE to front (for notifications)
function popUp() {
  if (!mainWindow) return;
  // Windows won't let apps steal focus normally.
  // Workaround: setAlwaysOnTop briefly to force it to front.
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.focus();
  setTimeout(() => {
    mainWindow.setAlwaysOnTop(false);
  }, 200);
  isVisible = true;
}

function snapToSide(side) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
  const { x: workX, y: workY } = primaryDisplay.workArea;
  const winWidth = 420;

  const x = side === 'left' ? workX : workX + screenW - winWidth;
  mainWindow.setBounds({ x, y: workY, width: winWidth, height: screenH });
  showWindow();
}

function expandWindow() {
  mainWindow.setSize(1000, mainWindow.getSize()[1]);
  mainWindow.center();
  showWindow();
}

function createTray() {
  // Generate a proper 16x16 icon programmatically
  const { nativeImage } = require('electron');
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2, dy = y - size / 2;
      const idx = (y * size + x) * 4;
      if (Math.sqrt(dx * dx + dy * dy) < size / 2 - 1) {
        buf[idx] = 99; buf[idx + 1] = 102; buf[idx + 2] = 241; buf[idx + 3] = 255;
      }
    }
  }
  const icon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Pai', click: showWindow },
    { label: 'Hide', click: hideWindow },
    { type: 'separator' },
    { label: 'Sidecar Right', click: () => snapToSide('right') },
    { label: 'Sidecar Left', click: () => snapToSide('left') },
    { label: 'Expand', click: expandWindow },
    { type: 'separator' },
    { label: 'Always on Top', type: 'checkbox', checked: false, click: (item) => {
      mainWindow.setAlwaysOnTop(item.checked);
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip('Pai - Personal AI');
  tray.setContextMenu(contextMenu);
  tray.on('click', toggleWindow);
  tray.on('double-click', showWindow);
}

// Settings
const fs = require('fs');
const settingsPath = path.join(
  process.env.LOCALAPPDATA || process.env.HOME || '.',
  'PersonalAssistant', 'settings.json'
);

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch { }
  return { shortcut: 'Ctrl+2' };
}

function saveSettings(settings) {
  try {
    const dir = path.dirname(settingsPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch { }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const settings = loadSettings();
  const shortcut = settings.shortcut || 'Ctrl+2';

  try {
    globalShortcut.register(shortcut, toggleWindow);
    console.log(`[Pai] Global shortcut registered: ${shortcut}`);
  } catch (err) {
    console.error(`[Pai] Failed to register shortcut ${shortcut}:`, err.message);
  }
}

// IPC: let renderer update shortcut
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, settings) => {
  saveSettings(settings);
  registerShortcuts();
  return { ok: true };
});

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { maximized: mainWindow.isMaximized() };
});

ipcMain.handle('window-hide', () => {
  hideWindow();
  return { ok: true };
});

ipcMain.handle('window-sidecar', (_, side) => {
  snapToSide(side || 'right');
  return { ok: true };
});

// Poll the server's SSE for notifications and pop up when needed
function watchNotifications() {
  const url = `http://localhost:${SERVER_PORT}/api/notifications/stream`;

  function connect() {
    const req = http.get(url, (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString();
        if (text.includes('event: reminder-due')) {
          popUp();
        }
      });
      res.on('end', () => setTimeout(connect, 5000));
      res.on('error', () => setTimeout(connect, 5000));
    });
    req.on('error', () => setTimeout(connect, 5000));
  }

  // Wait for server to be ready
  setTimeout(connect, 3000);
}

function startServer() {
  if (isDev) return;

  const serverPath = path.join(__dirname, '../server/dist/index.js');
  serverProcess = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(SERVER_PORT) },
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', (data) => console.log(`[Server] ${data}`));
  serverProcess.stderr.on('data', (data) => console.error(`[Server] ${data}`));
}

function ensureIcon() {
  const iconPath = path.join(__dirname, 'icon.png');
  const fs = require('fs');
  if (!fs.existsSync(iconPath)) {
    const minimalPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0xf3, 0xff, 0x61, 0x00, 0x00, 0x00,
      0x1a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x60, 0x60, 0x60, 0x60,
      0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60,
      0x60, 0x00, 0x00, 0x00, 0x44, 0x00, 0x01, 0x9b, 0x43, 0xc1, 0x6a, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    fs.writeFileSync(iconPath, minimalPng);
  }
}

// Single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    ensureIcon();
    startServer();
    createWindow();
    createTray();
    registerShortcuts();
    watchNotifications();
  });
}

app.on('window-all-closed', () => {});
app.on('activate', showWindow);

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
});
