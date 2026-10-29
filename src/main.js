'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require('electron');
const fs = require('fs');
const path = require('path');

const APP_DATA_DIR = path.join(app.getPath('appData'), 'SimpleTodo');
const DATA_FILE = path.join(APP_DATA_DIR, 'data.json');
const ASSETS = path.join(__dirname, '..', 'assets');

let win = null;
let tray = null;
let quitting = false;
let store = { version: 1, items: [], history: [], settings: {} };

/* ------------------------------------------------------------------ store */

function loadStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    store = {
      version: 1,
      items: Array.isArray(data.items) ? data.items : [],
      history: Array.isArray(data.history) ? data.history : [],
      settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
    };
  } catch (_) {
    /* first run or unreadable file: start empty */
  }
}

let saveTimer = null;
function saveStore() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(APP_DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
      try {
        fs.renameSync(tmp, DATA_FILE);
      } catch (_) {
        fs.copyFileSync(tmp, DATA_FILE);
        fs.unlinkSync(tmp);
      }
    } catch (err) {
      console.error('save failed', err);
    }
  }, 200);
}

function saveStoreNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (_) {}
}

/* ----------------------------------------------------------------- window */

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = clamp(Math.round(wa.width * 0.167), 280, 440);
  const height = clamp(Math.round(wa.height * 0.29), 260, 520);
  return {
    width,
    height,
    x: wa.x + wa.width - width - 16,
    y: wa.y + 16,
  };
}

function boundsStillVisible(b) {
  if (!b || !b.width || !b.height) return false;
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    const overlapX = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
    const overlapY = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
    return overlapX > 80 && overlapY > 60;
  });
}

function resolveBounds() {
  const saved = store.settings.bounds;
  if (saved && boundsStillVisible(saved)) {
    return {
      width: clamp(saved.width, 240, 4000),
      height: clamp(saved.height, 200, 4000),
      x: saved.x,
      y: saved.y,
    };
  }
  return defaultBounds();
}

function createWindow() {
  const bounds = resolveBounds();

  win = new BrowserWindow({
    ...bounds,
    minWidth: 240,
    minHeight: 200,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: '简单待办',
    icon: path.join(ASSETS, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(!!store.settings.alwaysOnTop, 'floating');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  if (process.env.SIMPLE_TODO_SHOT) {
    win.webContents.on('console-message', (event) => {
      console.log('[renderer]', event.message, event.lineNumber, event.sourceId);
    });
    win.once('ready-to-show', () => {
      setTimeout(async () => {
        try {
          if (process.env.SIMPLE_TODO_SHOT_JS) {
            await win.webContents.executeJavaScript(process.env.SIMPLE_TODO_SHOT_JS);
          }
          await new Promise((r) => setTimeout(r, 400));
          const image = await win.webContents.capturePage();
          fs.writeFileSync(process.env.SIMPLE_TODO_SHOT, image.toPNG());
        } catch (err) {
          console.error('shot failed', err);
        }
        if (process.env.SIMPLE_TODO_SHOT_KEEP !== '1') {
          quitting = true;
          app.quit();
        }
      }, 600);
    });
  }

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  const rememberBounds = debounce(() => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    store.settings.bounds = win.getNormalBounds();
    saveStore();
  }, 400);

  win.on('move', rememberBounds);
  win.on('resize', rememberBounds);
  win.on('show', buildTrayMenu);
  win.on('hide', buildTrayMenu);

  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (win && win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    showWindow();
  }
}

/* -------------------------------------------------------------- autostart */

function applyLaunchAtLogin(on) {
  store.settings.launchAtLogin = !!on;
  saveStore();
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      path: process.execPath,
      args: [],
    });
  } catch (_) {}
}

/* ------------------------------------------------------------------ tray  */

function trayImage() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function buildTrayMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: win && win.isVisible() ? '隐藏待办' : '显示待办',
      click: toggleWindow,
    },
    { type: 'separator' },
    {
      label: '置顶显示',
      type: 'checkbox',
      checked: !!store.settings.alwaysOnTop,
      click: (item) => setAlwaysOnTop(item.checked),
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: !!store.settings.launchAtLogin,
      click: (item) => {
        applyLaunchAtLogin(item.checked);
        notifyRenderer();
      },
    },
    { type: 'separator' },
    {
      label: '打开数据文件夹',
      click: () => shell.openPath(APP_DATA_DIR),
    },
    {
      label: '关于 简单待办',
      click: () => notifyRenderer('about'),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  if (tray) tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('简单待办');
  tray.on('click', toggleWindow);
  tray.on('double-click', showWindow);
  buildTrayMenu();
}

function setAlwaysOnTop(on) {
  store.settings.alwaysOnTop = !!on;
  saveStore();
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!on, 'floating');
  buildTrayMenu();
  notifyRenderer();
}

function notifyRenderer(reason) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('state:changed', { settings: publicSettings(), reason });
  }
}

function publicSettings() {
  return {
    alwaysOnTop: !!store.settings.alwaysOnTop,
    launchAtLogin: !!store.settings.launchAtLogin,
  };
}

/* ------------------------------------------------------------------- ipc  */

function setupIpc() {
  ipcMain.handle('app:init', () => ({
    data: { items: store.items, history: store.history },
    settings: Object.assign(publicSettings(), { hintShown: !!store.settings.hintShown }),
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));

  ipcMain.on('data:save', (_e, payload) => {
    if (!payload) return;
    if (Array.isArray(payload.items)) store.items = payload.items;
    if (Array.isArray(payload.history)) store.history = payload.history;
    if (payload.settings && typeof payload.settings === 'object') {
      store.settings = Object.assign({}, store.settings, payload.settings);
    }
    saveStore();
  });

  ipcMain.handle('win:bounds', () => (win && !win.isDestroyed() ? win.getBounds() : null));
  ipcMain.on('win:set-bounds', (_e, b) => {
    if (!win || win.isDestroyed() || !b) return;
    win.setBounds({
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.round(b.width),
      height: Math.round(b.height),
    });
  });

  ipcMain.on('win:pin', (_e, on) => setAlwaysOnTop(on));
  ipcMain.on('win:hide', () => win && win.hide());
  ipcMain.on('app:quit', () => {
    quitting = true;
    app.quit();
  });
  ipcMain.on('app:launch-at-login', (_e, on) => {
    applyLaunchAtLogin(on);
    buildTrayMenu();
  });
  ipcMain.on('app:open-data', () => shell.openPath(APP_DATA_DIR));
}

/* ------------------------------------------------------------------ boot  */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.ychen.simpletodo');
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    loadStore();
    setupIpc();
    createWindow();
    createTray();

    try {
      globalShortcut.register('CommandOrControl+Alt+T', toggleWindow);
    } catch (_) {}

    buildTrayMenu();

    if (app.isPackaged && store.settings.launchAtLogin) {
      applyLaunchAtLogin(true);
    }
  });

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });

  app.on('before-quit', () => {
    quitting = true;
    if (win && !win.isDestroyed()) {
      store.settings.bounds = win.getNormalBounds();
    }
    saveStoreNow();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
