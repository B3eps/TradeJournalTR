// Trade Günlüğü - Electron kabuğu (sabit exe)
// Uygulama kodu (server.cjs + public/) önce kullanıcı klasöründen yüklenir:
//   %APPDATA%\trade-gunlugu\app\   (server.cjs, schema.sql, public\, version.json)
// Orası yoksa veya bozuksa exe içindeki yedek sürüm kullanılır. Böylece güncelleme
// için exe'yi değiştirmek gerekmez, sadece bu klasördeki dosyalar yenilenir.
// Güncellemeler yalnızca yerel klasörden gelir, internetten kod indirilmez.
//
// Kabuk özellikleri: sistem tepsisi (pencere kapanınca arka planda çalışır; hatırlatıcılar,
// otomatik yedek ve haber bildirimleri sürer), global kısayollar
//   Ctrl+Alt+T : hızlı görev ekle (kullanımdaysa Ctrl+Shift+Alt+T, Ctrl+Alt+Space, Ctrl+Alt+N denenir)
//   Ctrl+Alt+S : ekran görüntüsü al (panoya kopyalar ve dosyaya kaydeder)
// ve isteğe bağlı "Windows ile başlat".
const {
  app, BrowserWindow, Menu, shell, dialog, Tray, nativeImage, globalShortcut,
  Notification, clipboard, desktopCapturer, screen,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Module = require('module');
const { waitForServer } = require('./boot-health');

const PORT = 8471;
const START_HIDDEN = process.argv.includes('--hidden');
const BOOT_TOKEN = crypto.randomBytes(32).toString('hex');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let quitting = false;
let iconPath = null;

// Dış bağlantılar: yalnızca http/https/mailto şemaları varsayılan tarayıcıda açılır.
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function openExternalSafe(url) {
  try {
    const u = new URL(String(url));
    if (SAFE_EXTERNAL_PROTOCOLS.has(u.protocol)) shell.openExternal(u.toString());
    else logRun(`engellenen dis baglanti semasi: ${u.protocol}`);
  } catch (e) { /* gecersiz URL: yok say */ }
}

// Uygulamanın kendi adresi (pencere yalnızca burada gezinebilir).
function isAppUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === String(PORT);
  } catch (e) { return false; }
}

function isValidUpdateDir(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8'));
    if (manifest.format !== 2 || !manifest.files || typeof manifest.files !== 'object') return false;
    const required = ['server.cjs', 'schema.sql', 'public/trades.html', 'public/assets/appBundle.js', 'public/assets/app.css'];
    if (required.some((name) => !Object.hasOwn(manifest.files, name))) return false;
    const root = path.resolve(dir) + path.sep;
    return Object.entries(manifest.files).every(([relative, expectedHash]) => {
      if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
      const file = path.resolve(dir, relative.replaceAll('/', path.sep));
      if (!file.startsWith(root) || !fs.statSync(file).isFile()) return false;
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      return actualHash.toLowerCase() === expectedHash.toLowerCase();
    });
  } catch (e) {
    return false;
  }
}

function logRun(line) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'last-run.log'), `${new Date().toISOString()} ${line}\n`);
  } catch (e) { /* günlük yazılamazsa sorun değil */ }
}

function showWindow() {
  if (!mainWindow) {
    createWindow(false);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendToApp(script) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(script).catch(() => { /* sayfa hazır değilse yok say */ });
}

function openQuickAdd() {
  showWindow();
  sendToApp(
    "window.dispatchEvent(new CustomEvent('app:navigate',{detail:{page:'tasks'}}));" +
    "setTimeout(function(){window.dispatchEvent(new CustomEvent('app:quick-add-task'));},250);"
  );
}

async function captureScreen() {
  try {
    const display = screen.getPrimaryDisplay();
    const scale = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) },
    });
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error('Ekran görüntüsü alınamadı');
    const image = source.thumbnail;
    clipboard.writeImage(image);
    const dir = path.join(app.getPath('userData'), 'ekran-goruntuleri');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `ekran-${stamp}.png`);
    fs.writeFileSync(file, image.toPNG());
    if (Notification.isSupported()) {
      new Notification({ title: 'Ekran görüntüsü alındı', body: 'Panoya kopyalandı; günlüğe yapıştırabilirsiniz.' }).show();
    }
    logRun(`ekran goruntusu: ${file}`);
  } catch (err) {
    logRun(`ekran goruntusu hatasi: ${err && err.message}`);
    if (Notification.isSupported()) {
      new Notification({ title: 'Ekran görüntüsü alınamadı', body: String((err && err.message) || err) }).show();
    }
  }
}

function loginItemEnabled() {
  try { return app.getLoginItemSettings().openAtLogin; } catch (e) { return false; }
}

function setLoginItem(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, // portable exe gerçek yolundan başlar
      args: ['--hidden'],
    });
  } catch (e) {
    logRun(`otomatik baslatma ayari yapilamadi: ${e && e.message}`);
  }
}

function buildTray() {
  try {
    let image = nativeImage.createFromPath(iconPath || '');
    if (image.isEmpty()) image = nativeImage.createEmpty();
    else image = image.resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('Trade Günlüğü');
    const rebuildMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Trade Günlüğü\'nü aç', click: showWindow },
      { label: `Hızlı görev ekle (${niceKey(quickAddKey)})`, click: openQuickAdd },
      { label: `Ekran görüntüsü al (${niceKey(screenshotKey)})`, click: captureScreen },
      { type: 'separator' },
      {
        label: 'Windows ile başlat',
        type: 'checkbox',
        checked: loginItemEnabled(),
        click: (item) => { setLoginItem(item.checked); rebuildMenu(); },
      },
      { type: 'separator' },
      { label: 'Çık', click: () => { quitting = true; app.quit(); } },
    ]));
    rebuildMenu();
    tray.on('click', showWindow);
  } catch (err) {
    logRun(`tepsi olusturulamadi: ${err && err.message}`);
    tray = null;
  }
}

// Bir kısayol başka bir program tarafından kullanılıyorsa sıradaki aday denenir.
let quickAddKey = null;
let screenshotKey = null;

function registerFirst(candidates, handler) {
  for (const key of candidates) {
    try {
      if (globalShortcut.register(key, handler)) return key;
    } catch (e) { /* sıradakini dene */ }
  }
  return null;
}

function niceKey(key) {
  return key ? key.replace('Control', 'Ctrl') : 'atanamadı';
}

function registerShortcuts() {
  quickAddKey = registerFirst(['Control+Alt+T', 'Control+Shift+Alt+T', 'Control+Alt+Space', 'Control+Alt+N'], openQuickAdd);
  screenshotKey = registerFirst(['Control+Alt+S', 'Control+Shift+Alt+S'], captureScreen);
  logRun(`kisayollar: hizli-gorev=${niceKey(quickAddKey)} ekran-goruntusu=${niceKey(screenshotKey)}`);
}

function createWindow(hidden) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: !hidden,
    backgroundColor: '#0a0a0a',
    title: 'Trade Günlüğü',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`http://localhost:${PORT}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  // Uygulama dışı gezinmeyi engelle; dış adresi varsayılan tarayıcıda aç.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  });
  // Pencereyi kapatmak uygulamayı bitirmez, tepsiye indirir (tepsi yoksa normal kapanır).
  mainWindow.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) { /* yok say */ } });

function startServer() {
  const bundledRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  const updateDir = path.join(app.getPath('userData'), 'app');
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.PORT = String(PORT);
  process.env.TRADE_GUNLUGU_BOOT_TOKEN = BOOT_TOKEN;
  iconPath = path.join(bundledRoot, 'public', 'assets', 'img', 'favicon.png');

  // better-sqlite3 exe içindedir; dışarıdan yüklenen server.cjs onu buradan bulur.
  const bundledModules = path.join(app.getAppPath(), 'node_modules');
  process.env.NODE_PATH = [bundledModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();

  if (isValidUpdateDir(updateDir)) {
    try {
      let version = '?';
      try { version = JSON.parse(fs.readFileSync(path.join(updateDir, 'version.json'), 'utf8')).version; } catch (e) { /* yok say */ }
      process.chdir(updateDir); // sunucu 'public' klasörünü cwd'den okur
      require(path.join(updateDir, 'server.cjs'));
      logRun(`kaynak=guncelleme-klasoru surum=${version}`);
      return;
    } catch (err) {
      logRun(`guncelleme klasoru yuklenemedi, yedege geciliyor: ${err && err.message}`);
    }
  }
  process.chdir(bundledRoot);
  require('./server.cjs');
  logRun('kaynak=exe-yedek');
}

app.whenReady().then(async () => {
  try {
    startServer();
    await waitForServer(`http://127.0.0.1:${PORT}/api/health`, BOOT_TOKEN, 20000);
    registerShortcuts(); // tepsi menüsü etiketleri gerçek kısayolu göstersin diye önce kaydedilir
    buildTray();
    createWindow(START_HIDDEN);
  } catch (err) {
    dialog.showErrorBox('Trade Günlüğü başlatılamadı', String((err && err.stack) || err));
    quitting = true;
    app.quit();
  }
});

// Tepsi varken pencere kapanınca uygulama arka planda sürer.
app.on('window-all-closed', () => { if (!tray) app.quit(); });
