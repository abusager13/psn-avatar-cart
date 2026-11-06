const { app, BrowserWindow, ipcMain, shell, clipboard, protocol, net, dialog } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ID = '2eb25762-877f-4140-b341-7c7e14c19f98';
const CHECKOUT = 'https://checkout.playstation.com/add';
const CATALOG = 'https://store.playstation.com/store/api/chihiro/00_09_000/container';
const SEARCH = 'https://commerce1.api.np.km.playstation.net/store/api/chihiro/00_09_000/search';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const REGIONS = ['US', 'GB', 'DE', 'FR', 'JP', 'PL', 'TR', 'AU', 'CA', 'IE', 'SE', 'ZA', 'IT', 'ES'];

let index = null;

function loadIndex() {
  if (index) return index;
  index = { sku: new Map(), game: new Map() };
  try {
    const file = path.join(__dirname, 'resources', 'avatar-sku-index.tsv');
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n').slice(1)) {
      const [hash, game, sku] = line.split('\t');
      if (!hash) continue;
      const key = hash.toUpperCase();
      if (game) index.game.set(key, game);
      if (sku) index.sku.set(key, sku.trim());
    }
  } catch (err) {
    console.error('index load failed:', err.message);
  }
  return index;
}

// Only allow artwork that Sony actually serves; the URL comes from an
// external response, so it is validated before it reaches the renderer.
function trustedImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host.endsWith('.playstation.net') || host.endsWith('.playstation.com')) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function stripVariant(sku) {
  const m = sku.match(/^(.*)-([A-Z][A-Z0-9]{3})$/);
  return m ? m[1] : sku;
}

class LookupError extends Error {
  constructor(kind, payload) {
    super(kind);
    this.kind = kind;
    this.payload = payload;
  }
}

async function fetchCatalog(base, region) {
  const url = `${CATALOG}/${region}/en/19/${base}/`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  } catch (err) {
    throw new LookupError('transport', { message: err.message });
  }
  if (res.status === 404) throw new LookupError('notSold', { region, base });
  if (!res.ok) throw new LookupError('transport', { message: `HTTP ${res.status}` });
  try {
    return await res.json();
  } catch {
    throw new LookupError('transport', { message: 'unparseable catalog JSON' });
  }
}

async function resolve(rawInput, region) {
  const cleaned = String(rawInput || '')
    .trim()
    .toUpperCase()
    .replace(/PSNA_/g, '')
    .replace(/\.EDAT/g, '')
    .trim();

  let sku;
  let source;
  let game = null;

  if (/^[0-9A-F]{40}$/.test(cleaned)) {
    const hit = loadIndex().sku.get(cleaned);
    if (!hit) throw new LookupError('notInArchive', { hash: cleaned });
    sku = hit;
    game = loadIndex().game.get(cleaned) || null;
    source = 'PSNA hash → SKU';
  } else if (cleaned.includes('-') && cleaned.includes('_')) {
    sku = cleaned;
    source = 'Direct SKU lookup';
  } else {
    throw new LookupError('badInput', {});
  }

  const base = stripVariant(sku);
  const data = await fetchCatalog(base, region);
  const ds = data.default_sku || {};
  const checkoutSku = ds.id || base;
  const images = Array.isArray(data.images) ? data.images : [];
  const rawImage = images.length ? images[images.length - 1].url : null;
  const image = trustedImageUrl(rawImage);

  return {
    name: data.name || '(unnamed)',
    platform: (data.playable_platform || ['?'])[0],
    price: ds.display_price || '—',
    baseSku: base,
    checkoutSku,
    link: `${CHECKOUT}/${checkoutSku}?clientId=${CLIENT_ID}`,
    image,
    game,
    region,
    source,
  };
}

// The archive stores the SKU found inside each EDAT, i.e. the listing for the
// region that file came from. The same artwork is a different product elsewhere,
// so a US lookup of an EU SKU 404s even though the avatar is sold there.
function homeRegion(sku) {
  const prefix = String(sku).slice(0, 2).toUpperCase();
  if (prefix === 'EP') return 'GB';
  if (prefix === 'JP') return 'JP';
  if (prefix === 'HP') return 'HK';
  return 'US';
}

function normName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u00ae\u2122\u00a9]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function findTwin(base, targetRegion) {
  const home = homeRegion(base);
  if (home === targetRegion) return null;

  let sourceName = null;
  try {
    const d = await fetchCatalog(base, home);
    sourceName = d && d.name;
  } catch {
    return null;
  }
  if (!sourceName) return null;

  const target = normName(sourceName);
  if (!target) return null;

  let data;
  try {
    const res = await fetch(`${SEARCH}/${targetRegion}/en/19/${encodeURIComponent(sourceName)}?platform=ps3`);
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  for (const item of (data && data.links) || []) {
    if (item.top_category !== 'avatar') continue;
    const cand = normName(item.name);
    if (!cand) continue;
    if (cand.includes(target) || target.includes(cand)) {
      return { sku: item.id, name: item.name, home, sourceName };
    }
  }
  return null;
}

async function liveRegions(base, excluding) {
  const targets = REGIONS.filter((r) => r !== excluding);
  const results = await Promise.all(
    targets.map(async (cc) => {
      try {
        await fetchCatalog(base, cc);
        return cc;
      } catch {
        return null;
      }
    })
  );
  return REGIONS.filter((r) => results.includes(r));
}

function messageFor(err, regions) {
  switch (err.kind) {
    case 'badInput':
      return 'Paste a 40-character PSNA hash, or a full SKU like UP1004-BLUS30418_00-AVARDRSHADOWWOLF.';
    case 'notInArchive':
      return `${err.payload.hash} isn't in the archive index.\nIt covers the 5,415 avatars from the PS3-Avatars-Edat collection.`;
    case 'notSold': {
      if (!regions) return `Not sold in ${err.payload.region}.`;
      if (regions.length === 0) {
        return `Not sold in ${err.payload.region} — and not in any of the other ${REGIONS.length - 1} tracked stores either. This SKU is delisted as far as I can check.`;
      }
      return `Not sold in ${err.payload.region}. Still on sale in: ${regions.join(', ')}. Switch the region chip to one of those.`;
    }
    case 'transport':
    default:
      return `Catalog request failed: ${(err.payload && err.payload.message) || 'unknown error'}`;
  }
}

// ---------------------------------------------------------------- window

let win = null;

// Only the app's own bundle may drive IPC.
function trustedSender(event) {
  try {
    const frame = event.senderFrame;
    if (!frame) return false;
    const url = new URL(frame.url);
    return url.protocol === 'app:' && url.host === 'bundle';
  } catch {
    return false;
  }
}

const ipcRegister = ipcMain.handle.bind(ipcMain);
const handle = (channel, fn) =>
  ipcRegister(channel, (event, ...args) => {
    if (!trustedSender(event)) throw new Error('blocked: untrusted IPC sender');
    return fn(event, ...args);
  });

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const snapIdx = process.argv.indexOf('--snapshot');
const snapPath = snapIdx > -1 ? process.argv[snapIdx + 1] : null;
const snapState = snapIdx > -1 ? process.argv[snapIdx + 2] || 'card' : null;

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 760,
    minHeight: 420,
    show: false,
    backgroundColor: '#0E1014',
    title: 'PSN Avatar Cart',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const url = 'app://bundle/index.html' + (snapState ? `?snap=${encodeURIComponent(snapState)}` : '');
  win.loadURL(url);

  win.once('ready-to-show', () => {
    if (!snapPath) {
      win.show();
      win.webContents.send('focus-input');
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && url.startsWith('https://checkout.playstation.com/')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://bundle/')) event.preventDefault();
  });

  if (process.argv.includes('--ipc-selftest')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        const report = await win.webContents.executeJavaScript(`(async () => {
          const api = window.api || {};
          let pasteCall = 'ok';
          try { await api.paste(); } catch (e) { pasteCall = 'ERR ' + e.message; }
          const probe = async (p) => {
            try { const r = await fetch(p); return r.status; } catch (e) { return 'throw'; }
          };
          return {
            keys: Object.keys(api).sort(),
            hasPaste: typeof api.paste === 'function',
            pasteCall,
            traversal: await probe('app://bundle/%2e%2e/%2e%2e/etc/passwd'),
            encodedEscape: await probe('app://bundle/..%2fpackage.json'),
            siblingPrefix: await probe('app://bundle/..%2fdist-evil%2fsecret.txt'),
            normal: await probe('app://bundle/index.html'),
          };
        })()`);
        console.log('IPC_SELFTEST ' + JSON.stringify(report));
      } catch (err) {
        console.log('IPC_SELFTEST ERROR ' + err.message);
      }
      app.quit();
    });
  }

  win.on('closed', () => { win = null; });
}

handle('resolve', async (_e, { input, region }) => {
  try {
    const card = await resolve(input, region);
    return { ok: true, card };
  } catch (err) {
    if (err instanceof LookupError && err.kind === 'notSold') {
      const twin = await findTwin(err.payload.base, err.payload.region);
      if (twin) {
        try {
          const card = await resolve(twin.sku, err.payload.region);
          card.source = `Same avatar as "${twin.sourceName}" (${twin.home} listing)`;
          return {
            ok: true,
            card,
            note: `That SKU is ${twin.home}-only. Showing the ${err.payload.region} listing of the same avatar: ${card.name}.`,
          };
        } catch {
          /* fall through to the region hunt */
        }
      }
      const regions = await liveRegions(err.payload.base, err.payload.region);
      return { ok: false, message: messageFor(err, regions) };
    }
    if (err instanceof LookupError) {
      return { ok: false, message: messageFor(err) };
    }
    return { ok: false, message: `Unexpected failure: ${err.message}` };
  }
});

handle('open', (_e, url) => {
  if (typeof url === 'string' && url.startsWith('https://checkout.playstation.com/')) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

handle('paste', () => clipboard.readText());

// A PSNA .edat keeps its content ID in plaintext at offset 0x10, so a file
// is enough to recover the store SKU even when the hash is not in our index.
function decodeEdat(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(64);
    fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);

    if (buf.subarray(0, 4).toString('latin1') !== 'NPD\u0000') {
      return { ok: false, message: 'Not a PSNA avatar file — header magic is missing.' };
    }
    const cid = buf.subarray(16, 64).toString('latin1').replace(/\u0000+$/, '').trim();
    if (!/^[A-Z]{2}\d{4}-[A-Z0-9]{4,}_\d{2}-/.test(cid)) {
      return { ok: false, message: `Header content ID looks wrong: ${cid}` };
    }
    const match = path.basename(filePath).match(/PSNA_([0-9A-Fa-f]{40})/i);
    return { ok: true, sku: cid, hash: match ? match[1].toUpperCase() : null, file: path.basename(filePath) };
  } catch (err) {
    return { ok: false, message: `Could not read file: ${err.message}` };
  }
}

handle('pick-edat', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open a PSNA .edat file',
    filters: [{ name: 'PSNA avatar', extensions: ['edat'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return decodeEdat(result.filePaths[0]);
});

handle('copy', (_e, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

handle('resize', (_e, height) => {
  if (!win) return;
  const bounds = win.getBounds();
  const clamped = Math.max(420, Math.min(1100, Math.round(height)));
  if (Math.abs(bounds.height - (clamped + 28)) > 2) {
    win.setBounds({ ...bounds, height: clamped + 28 });
  }
});

handle('snapshot-ready', async () => {
  if (!snapPath) return;
  await new Promise((r) => setTimeout(r, 700));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(snapPath, image.toPNG());
  console.log('wrote', snapPath);
  app.quit();
});

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const parsed = new URL(request.url);
    const relative = decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname);
    const distRoot = path.join(__dirname, 'dist');
    const target = path.resolve(distRoot, relative.replace(/^\/+/, ''));
    const contained = path.relative(distRoot, target);
    if (contained.startsWith('..') || path.isAbsolute(contained)) {
      return new Response('forbidden', { status: 403 });
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return new Response('not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
