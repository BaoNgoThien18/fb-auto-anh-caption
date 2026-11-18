// background.js — Cấp ảnh + caption chưa dùng cho content script, ghi lịch sử "đã dùng" (riêng từng profile, theo thư mục).
importScripts('lib/picker.js');
const P = self.FbAutoPicker;
const RESERVE_MS = 10 * 60 * 1000; // giữ chỗ khi đã điền nhưng chưa bấm Post (tránh 2 tab lấy trùng)
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

async function settings() {
  const res = await fetch(chrome.runtime.getURL('settings.json'), { cache: 'no-store' });
  const s = await res.json();
  return { folder: String(s.folder || ''), captionFile: String(s.captionFile || ''), enabled: s.enabled !== false, splitCollage: s.splitCollage !== false };
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  try {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Đọc ảnh và caption từ thư mục trên máy (file://)' });
  } catch (err) {
    if (!/single offscreen|already/i.test(err.message)) throw err;
  }
}

async function offscreen(type, url, extra = {}) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type, url, ...extra });
  if (!res?.ok) throw new Error(res?.error || 'Offscreen không phản hồi');
  return res;
}

const historyKey = folderUrl => `history:${folderUrl}`;
async function loadState(folderUrl) {
  const key = historyKey(folderUrl);
  const saved = (await chrome.storage.local.get([key, 'reserved']));
  const history = saved[key] || { images: [], captions: [] };
  const now = Date.now();
  const reserved = (saved.reserved || []).filter(r => r.folderUrl === folderUrl && now - r.at < RESERVE_MS);
  return { key, history, reserved };
}

// ---------- Thư mục chung trong Downloads (chống trùng giữa mọi profile) ----------
// Extension chỉ ghi được file vào Downloads (chrome.downloads). Khi bấm Post → ghi file đánh dấu vào <thư mục>/da-dang/.
// Mọi profile đọc da-dang/ trước khi chọn → ảnh/ô ảnh/caption đã đăng ở bất kỳ profile nào sẽ không bị lấy lại.
const MARK_DIR = 'da-dang';
const MARK_README = 'Mỗi file trong thư mục này đánh dấu 1 ảnh (anh_...) hoặc 1 caption (cap_...) ĐÃ ĐĂNG.\n'
  + 'Mọi profile dùng chung thư mục ảnh sẽ không đăng lại những thứ có ở đây.\n'
  + 'Muốn dùng lại ảnh/caption nào thì xóa file tương ứng. Xóa hết = dùng lại từ đầu.\n';

async function writeDownload(relPath, text) {
  try { await chrome.downloads.setUiOptions({ enabled: false }); } catch (_) {}
  try {
    const id = await chrome.downloads.download({
      url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(text),
      filename: relPath, conflictAction: 'overwrite', saveAs: false,
    });
    let item;
    for (let i = 0; i < 100; i++) {
      [item] = await chrome.downloads.search({ id });
      if (item && item.state !== 'in_progress') break;
      await new Promise(r => setTimeout(r, 100));
    }
    try { await chrome.downloads.erase({ id }); } catch (_) {} // chỉ xóa khỏi lịch sử tải, file vẫn giữ
    if (item?.state !== 'complete') throw new Error(`Không ghi được ${relPath}: ${item?.error || 'quá thời gian'}`);
    const abs = String(item.filename || '').replace(/\\/g, '/');
    if (!abs.endsWith('/' + relPath)) {
      throw new Error('Chrome không lưu file vào thư mục Downloads (có thể đang bật "Hỏi nơi lưu mỗi lần tải" hoặc có công cụ tự động hóa chiếm quyền tải xuống).');
    }
    return abs;
  } finally {
    try { await chrome.downloads.setUiOptions({ enabled: true }); } catch (_) {}
  }
}

// Đường dẫn tuyệt đối của thư mục chung: ghi README vào da-dang/ để biết Downloads nằm ở đâu (đồng thời tạo thư mục)
async function sharedFolderPath(sub) {
  const key = `sharedPath:${sub}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached) return cached;
  const rel = `${sub}/${MARK_DIR}/README.txt`;
  const abs = await writeDownload(rel, MARK_README);
  const folder = abs.slice(0, abs.length - rel.length) + sub;
  await chrome.storage.local.set({ [key]: folder });
  return folder;
}

async function sharedMarkers(folderUrl) {
  try { return P.parseMarkers(P.parseDirListing((await offscreen('LIST_DIR', `${folderUrl}${MARK_DIR}/`)).html).map(f => f.name)); }
  catch (_) { return { anh: new Set(), cap: new Set() }; }
}

async function writeMarkers(sub, item) {
  if (item.image) await writeDownload(`${sub}/${MARK_DIR}/${P.markerName('anh', item.image)}`, `${item.image}\n`);
  if (item.caption) await writeDownload(`${sub}/${MARK_DIR}/${P.markerName('cap', item.caption)}`, `${item.caption}\n`);
}

// Chưa có caption trong thư mục chung → chép file caption mẫu của extension sang để người dùng sửa
async function seedCaptions(sub, files, wanted) {
  if (P.captionFile(files, wanted)) return false;
  let sample = 'Chào buổi sáng cả nhà 🌞\nHôm nay trời đẹp quá mọi người ơi\n';
  try { sample = await (await fetch(chrome.runtime.getURL('anh/captions.txt'))).text(); } catch (_) {}
  await writeDownload(`${sub}/${wanted || 'captions.txt'}`, sample);
  return true;
}

// Đọc thư mục: danh sách ảnh + danh sách caption.
// - "Downloads/<tên>": thư mục chung trong Downloads, chống trùng giữa mọi profile (đọc qua file:///).
// - folder tương đối (vd "anh"): thư mục nằm trong extension; danh sách file do popup/lister.html quét rồi gửi PKG_LIST.
// - folder tuyệt đối: đọc qua file:/// (cần bật "Allow access to file URLs").
const pkgKey = dir => `pkg:${dir}`;
async function readFolder() {
  const s = await settings();
  if (!s.folder) throw new Error('Chưa điền "folder" trong settings.json');
  const dir = P.packageDir(s.folder);
  const shared = P.sharedDir(s.folder);
  let folderUrl, files;
  if (shared) {
    folderUrl = P.folderToFileUrl(await sharedFolderPath(shared));
    files = P.parseDirListing((await offscreen('LIST_DIR', folderUrl)).html);
    if (await seedCaptions(shared, files, s.captionFile)) files = P.parseDirListing((await offscreen('LIST_DIR', folderUrl)).html);
  } else if (dir) {
    folderUrl = chrome.runtime.getURL(dir + '/');
    files = (await chrome.storage.local.get(pkgKey(dir)))[pkgKey(dir)];
    if (!files) throw new Error(`Chưa quét thư mục "${dir}". Mở popup extension hoặc mở hộp Create post để quét.`);
  } else {
    folderUrl = P.folderToFileUrl(s.folder);
    files = P.parseDirListing((await offscreen('LIST_DIR', folderUrl)).html);
  }
  const images = P.imageFiles(files);
  const capFile = P.captionFile(files, s.captionFile);
  const captions = capFile ? P.parseCaptions((await offscreen('READ_TEXT', folderUrl + capFile.href)).text) : [];
  const markers = shared ? await sharedMarkers(folderUrl) : { anh: new Set(), cap: new Set() };
  return { s, shared, folderUrl, images, capFile, captions, markers };
}

// Đã dùng = lịch sử của profile này ∪ file đánh dấu chung (da-dang/) của mọi profile
function usedImageKeys(pool, f, extra = []) {
  const keys = new Set(extra);
  for (const e of pool) {
    if (f.markers.anh.has(P.stableHash(e.key)) || f.markers.anh.has(P.stableHash(e.name))) keys.add(e.key);
  }
  return keys;
}
function usedCaptions(f, extra = []) {
  const set = new Set(extra);
  for (const c of f.captions) if (f.markers.cap.has(P.stableHash(c))) set.add(c);
  return set;
}

// Kết quả dò ảnh ghép được nhớ theo thư mục + chữ ký file (size:mtime) → mỗi ảnh chỉ phân tích 1 lần
const tilesKey = folderUrl => `tiles:${folderUrl}`;
async function tileMap(f) {
  if (!f.s.splitCollage) return {};
  const key = tilesKey(f.folderUrl);
  const map = (await chrome.storage.local.get(key))[key] || {};
  let changed = false;
  for (const img of f.images) {
    const sig = P.fileSig(img);
    if (map[img.name]?.sig === sig) continue;
    const ext = img.name.split('.').pop().toLowerCase();
    let tiles = [];
    try { tiles = (await offscreen('ANALYZE', f.folderUrl + img.href, { mime: MIME[ext] || 'image/jpeg' })).tiles || []; }
    catch (_) { tiles = []; } // ảnh lỗi → coi như ảnh thường
    map[img.name] = { sig, tiles };
    changed = true;
  }
  for (const name of Object.keys(map)) if (!f.images.some(i => i.name === name)) { delete map[name]; changed = true; }
  if (changed) await chrome.storage.local.set({ [key]: map });
  return map;
}

// Kho ảnh hiện tại: ảnh thường + từng ô của ảnh ghép
async function readPool() {
  const f = await readFolder();
  const pool = P.buildPool(f.images, await tileMap(f));
  return { f, pool };
}

async function status() {
  const s = await settings();
  try {
    const { f, pool } = await readPool();
    const { history, reserved } = await loadState(f.folderUrl);
    const usedImg = P.blockedKeys(pool, usedImageKeys(pool, f, history.images)), usedCap = usedCaptions(f, history.captions);
    const collages = new Set(pool.filter(e => e.tile).map(e => e.name));
    return {
      ok: true, enabled: s.enabled, splitCollage: s.splitCollage, folder: s.folder, captionFile: f.capFile?.name || '',
      shared: f.shared, sharedPath: f.shared ? decodeURIComponent(f.folderUrl.replace(/^file:\/\//, '')) : '',
      sharedMarked: f.markers.anh.size + f.markers.cap.size,
      images: { total: pool.length, used: pool.filter(e => usedImg.has(e.key)).length },
      files: f.images.length, collages: collages.size, tiles: pool.filter(e => e.tile).length,
      captions: { total: f.captions.length, used: f.captions.filter(c => usedCap.has(c)).length },
      reserved: reserved.length,
    };
  } catch (err) {
    return { ok: false, enabled: s.enabled, folder: s.folder, error: err.message };
  }
}

async function next() {
  const { f, pool } = await readPool();
  if (!f.s.enabled) return { ok: false, error: 'Đang tắt (enabled: false trong settings.json)' };
  const { history, reserved } = await loadState(f.folderUrl);
  const blockedImg = P.blockedKeys(pool, usedImageKeys(pool, f, [...history.images, ...reserved.map(r => r.image)]));
  const blockedCap = usedCaptions(f, [...history.captions, ...reserved.map(r => r.caption)]);
  const imageKey = P.pickUnused(pool.map(e => e.key), blockedImg);
  const caption = P.pickUnused(f.captions, blockedCap);
  if (!imageKey && !caption) return { ok: false, error: 'Đã dùng hết ảnh và caption trong thư mục' };
  // Mỗi bài 1 ảnh: ảnh thường giữ nguyên, ảnh ghép thì cắt đúng 1 ô đã chọn
  let files = [];
  let label = '';
  if (imageKey) {
    const entry = pool.find(e => e.key === imageKey);
    const file = f.images.find(i => i.name === entry.name);
    const ext = entry.name.split('.').pop().toLowerCase();
    const mime = MIME[ext] || 'image/jpeg';
    if (entry.tile) {
      const base64 = (await offscreen('CROP', f.folderUrl + file.href, { mime, rect: entry.rect })).base64;
      files = [{ name: `${entry.name.replace(/\.[^.]+$/, '')}-${String(entry.tile).padStart(2, '0')}.jpg`, mime: 'image/jpeg', base64 }];
      label = `ô ${entry.tile}/${entry.of} của ${entry.name}`;
    } else {
      files = [{ name: entry.name, mime, base64: (await offscreen('READ_BINARY', f.folderUrl + file.href)).base64 }];
      label = entry.name;
    }
  }
  const token = crypto.randomUUID();
  const saved = (await chrome.storage.local.get('reserved')).reserved || [];
  saved.push({ token, folderUrl: f.folderUrl, shared: f.shared, image: imageKey, caption, at: Date.now() });
  await chrome.storage.local.set({ reserved: saved.filter(r => Date.now() - r.at < RESERVE_MS) });
  return { ok: true, token, caption, image: label, files, warnings: [!imageKey && 'Hết ảnh chưa dùng', !caption && 'Hết caption chưa dùng'].filter(Boolean) };
}

async function finish(token, used) {
  const all = (await chrome.storage.local.get('reserved')).reserved || [];
  const item = all.find(r => r.token === token);
  await chrome.storage.local.set({ reserved: all.filter(r => r.token !== token) });
  if (!item || !used) return { ok: true, released: Boolean(item) };
  const { key, history } = await loadState(item.folderUrl);
  if (item.image && !history.images.includes(item.image)) history.images.push(item.image);
  if (item.caption && !history.captions.includes(item.caption)) history.captions.push(item.caption);
  await chrome.storage.local.set({ [key]: history });
  // Thư mục chung → ghi file đánh dấu để các profile khác không đăng lại
  let markError = '';
  if (item.shared) { try { await writeMarkers(item.shared, item); } catch (err) { markError = err.message; } }
  return { ok: true, image: item.image, caption: item.caption, markError };
}

async function resetHistory() {
  const f = await readFolder();
  await chrome.storage.local.remove(historyKey(f.folderUrl));
  await chrome.storage.local.set({ reserved: [] });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target === 'offscreen') return;
  const run = {
    NEXT: () => next(),
    USED: () => finish(msg.token, true),
    RELEASE: () => finish(msg.token, false),
    STATUS: () => status(),
    PREPARE: async () => ({ ok: true, packageDir: P.packageDir((await settings()).folder) }),
    PKG_LIST: async () => {
      const dir = P.packageDir(msg.dir);
      if (!dir || !Array.isArray(msg.files)) return { ok: false, error: 'Danh sách file không hợp lệ' };
      await chrome.storage.local.set({ [pkgKey(dir)]: msg.files });
      return { ok: true };
    },
    RESET: () => resetHistory(),
  }[msg?.type];
  if (!run) return;
  run().then(sendResponse, err => sendResponse({ ok: false, error: err.message }));
  return true;
});

// Cài mới / tải lại extension: tab Facebook đang mở chưa có content.js (Chrome chỉ chèn khi tải trang)
// → tự chèn luôn, người dùng không cần F5.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ['https://www.facebook.com/*', 'https://web.facebook.com/*'] });
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
  }
});
