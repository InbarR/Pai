const { app, BrowserWindow, Tray, Menu, screen, globalShortcut, ipcMain, shell, Notification } = require('electron');
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

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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

  // Re-assert always-on-top when in sidecar mode and window loses focus
  mainWindow.on('blur', () => {
    if (mainWindow && mainWindow.isAlwaysOnTop()) {
      // Re-show to keep it visible above other windows
      mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
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
  if (isVisible) {
    hideWindow();
  } else {
    // Always show as sidecar
    snapToSide('right');
    mainWindow.show();
    mainWindow.focus();
    isVisible = true;
    // Tell renderer to switch to sidecar mode
    mainWindow.webContents.executeJavaScript(`
      window.dispatchEvent(new Event('pai-force-sidecar'));
      setTimeout(() => {
        const input = document.querySelector('.chat-input-bar textarea');
        if (input) input.focus();
      }, 150);
    `).catch(() => {});
  }
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
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
  const { x: workX, y: workY } = primaryDisplay.workArea;
  const isWide = side === 'right-wide' || side === 'left-wide';
  const winWidth = isWide ? Math.min(700, Math.floor(screenW * 0.45)) : 420;
  const actualSide = side.replace('-wide', '');

  const x = actualSide === 'left' ? workX : workX + screenW - winWidth;
  mainWindow.setBounds({ x, y: workY, width: winWidth, height: screenH });
  mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
  showWindow();
}

function expandWindow() {
  mainWindow.setSize(1000, mainWindow.getSize()[1]);
  mainWindow.center();
  showWindow();
}

function createTray() {
  const { nativeImage } = require('electron');
  const iconPath = path.join(__dirname, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
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
  mainWindow.setAlwaysOnTop(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  // Use large bounds instead of maximize so window stays resizable
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
  const { x: workX, y: workY } = primaryDisplay.workArea;
  const w = Math.floor(screenW * 0.85);
  const h = Math.floor(screenH * 0.9);
  mainWindow.setBounds({
    x: workX + Math.floor((screenW - w) / 2),
    y: workY + Math.floor((screenH - h) / 2),
    width: w,
    height: h,
  });
  showWindow();
  return { maximized: false };
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
      let sseBuffer = '';
      res.on('data', (chunk) => {
        sseBuffer += chunk.toString();
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        let eventType = '';
        let eventData = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          if (line.startsWith('data: ') && eventType) {
            eventData = line.slice(6).trim();
            try {
              const data = JSON.parse(eventData);
              if (eventType === 'reminder-due') {
                const notif = new Notification({
                  title: 'Pai Reminder',
                  body: data.title || 'You have a reminder',
                  icon: path.join(__dirname, 'icon.png'),
                });
                notif.on('click', () => popUp());
                notif.show();
              } else if (eventType === 'meeting-soon') {
                const notif = new Notification({
                  title: `Meeting: ${data.subject || 'Upcoming'}`,
                  body: `Starting at ${new Date(data.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                  icon: path.join(__dirname, 'icon.png'),
                });
                notif.on('click', () => popUp());
                notif.show();
              }
            } catch {}
            eventType = '';
            eventData = '';
          }
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
