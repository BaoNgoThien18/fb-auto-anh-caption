// background.js — Cấp ảnh + caption chưa dùng cho content script, ghi lịch sử "đã dùng" (riêng từng profile, theo thư mục).
importScripts('lib/picker.js');
const P = self.FbAutoPicker;
const RESERVE_MS = 10 * 60 * 1000; // giữ chỗ khi đã điền nhưng chưa bấm Post (tránh 2 tab lấy trùng)
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

async function settings() {
  const res = await fetch(chrome.runtime.getURL('settings.json'), { cache: 'no-store' });
  const s = await res.json();
  return { folder: String(s.folder || ''), captionFile: String(s.captionFile || ''), enabled: s.enabled !== false, splitCollage: s.splitCollage !== false,
    // Chờ bao nhiêu giây sau khi mở hộp tạo bài rồi mới điền (0–60, mặc định 2)
    delaySeconds: Number.isFinite(Number(s.delaySeconds)) ? Math.min(60, Math.max(0, Number(s.delaySeconds))) : 2,
    // Số ảnh mỗi bài (1–10, mặc định 2)
    imagesPerPost: Number.isFinite(Number(s.imagesPerPost)) ? Math.min(10, Math.max(1, Math.round(Number(s.imagesPerPost)))) : 2 };
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

const ASK_ERROR = 'Chrome đang bật "Hỏi vị trí lưu từng tệp trước khi tải xuống" nên extension không ghi được vào Downloads/'
  + ' → mở chrome://settings/downloads, TẮT mục đó, rồi bấm vào icon extension để thử lại.';

async function writeDownload(relPath, text) {
  try { await chrome.downloads.setUiOptions({ enabled: false }); } catch (_) {}
  try {
    const id = await chrome.downloads.download({
      url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(text),
      filename: relPath, conflictAction: 'overwrite', saveAs: false,
    });
    // File chữ nhỏ ghi xong trong vài trăm ms. Sau 1s vẫn chưa có tên file = Chrome đang mở hộp "Lưu thành…"
    // (bật "Hỏi vị trí lưu từng tệp") → chờ người dùng bấm Lưu tối đa 2 phút, không bỏ ngang rồi hỏi lại.
    let item, prompted = false;
    const start = Date.now();
    for (;;) {
      [item] = await chrome.downloads.search({ id });
      if (item && item.state !== 'in_progress') break;
      if (!prompted && Date.now() - start > 1000 && !item?.filename) prompted = true;
      if (Date.now() - start > (prompted ? 120000 : 10000)) break;
      await new Promise(r => setTimeout(r, 150));
    }
    if (item?.state === 'in_progress') { try { await chrome.downloads.cancel(id); } catch (_) {} }
    try { await chrome.downloads.erase({ id }); } catch (_) {} // chỉ xóa khỏi lịch sử tải, file vẫn giữ
    const abs = String(item?.filename || '').replace(/\\/g, '/');
    if (item?.state === 'complete' && abs.endsWith('/' + relPath)) {
      await chrome.storage.local.set({ askWarned: prompted }); // còn bật hỏi nơi lưu → popup nhắc tắt
      return abs;
    }
    if (prompted || item?.state === 'complete') throw new Error(ASK_ERROR);
    throw new Error(`Không ghi được ${relPath}: ${item?.error || 'quá thời gian'}`);
  } finally {
    try { await chrome.downloads.setUiOptions({ enabled: true }); } catch (_) {}
  }
}

// Đường dẫn tuyệt đối của thư mục chung: ghi README vào da-dang/ để biết Downloads nằm ở đâu (đồng thời tạo thư mục)
async function sharedFolderPath(sub) {
  const key = `sharedPath:${sub}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached) return cached;
  // Đã từng hỏi nơi lưu mà không xong → không tự mở lại hộp "Lưu thành…" mỗi lần mở hộp tạo bài.
  // Chỉ thử lại khi người dùng bấm icon extension (popup gọi STATUS, xóa cờ này).
  if ((await chrome.storage.local.get('askBlocked')).askBlocked) throw new Error(ASK_ERROR);
  const rel = `${sub}/${MARK_DIR}/README.txt`;
  let abs;
  try { abs = await writeDownload(rel, MARK_README); }
  catch (err) {
    if (err.message === ASK_ERROR) await chrome.storage.local.set({ askBlocked: true });
    throw err;
  }
  const folder = abs.slice(0, abs.length - rel.length) + sub;
  await chrome.storage.local.set({ [key]: folder });
  return folder;
}

async function sharedMarkers(folderUrl) {
  try { return P.parseMarkers(P.parseDirListing((await offscreen('LIST_DIR', `${folderUrl}${MARK_DIR}/`)).html).map(f => f.name)); }
  catch (_) { return { anh: new Set(), cap: new Set() }; }
}

// Bộ ảnh của 1 bài (bản cũ lưu 1 ảnh ở .image, bản mới lưu mảng .images)
const itemImages = item => (Array.isArray(item?.images) ? item.images : [item?.image]).filter(Boolean);

async function writeMarkers(sub, item) {
  for (const img of itemImages(item)) await writeDownload(`${sub}/${MARK_DIR}/${P.markerName('anh', img)}`, `${img}\n`);
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
  // Bấm icon extension = cho thử ghi lại vào Downloads + dò lại vị trí Downloads (phòng khi vừa đổi "Vị trí" trong Chrome)
  const cachedPaths = Object.keys(await chrome.storage.local.get(null)).filter(k => k.startsWith('sharedPath:'));
  await chrome.storage.local.remove(['askBlocked', ...cachedPaths]);
  try {
    const { f, pool } = await readPool();
    const { history, reserved } = await loadState(f.folderUrl);
    const usedImg = P.blockedKeys(pool, usedImageKeys(pool, f, history.images)), usedCap = usedCaptions(f, history.captions);
    const collages = new Set(pool.filter(e => e.tile).map(e => e.name));
    return {
      ok: true, enabled: s.enabled, splitCollage: s.splitCollage, imagesPerPost: s.imagesPerPost, folder: s.folder, captionFile: f.capFile?.name || '',
      shared: f.shared, sharedPath: f.shared ? decodeURIComponent(f.folderUrl.replace(/^file:\/\//, '')) : '',
      sharedMarked: f.markers.anh.size + f.markers.cap.size,
      images: { total: pool.length, used: pool.filter(e => usedImg.has(e.key)).length },
      files: f.images.length, collages: collages.size, tiles: pool.filter(e => e.tile).length,
      captions: { total: f.captions.length, used: f.captions.filter(c => usedCap.has(c)).length },
      reserved: reserved.length,
      askWarned: Boolean((await chrome.storage.local.get('askWarned')).askWarned),
    };
  } catch (err) {
    return { ok: false, enabled: s.enabled, folder: s.folder, error: err.message };
  }
}

async function next() {
  const { f, pool } = await readPool();
  if (!f.s.enabled) return { ok: false, error: 'Đang tắt (enabled: false trong settings.json)' };
  const { history, reserved } = await loadState(f.folderUrl);
  const blockedImg = P.blockedKeys(pool, usedImageKeys(pool, f, [...history.images, ...reserved.flatMap(itemImages)]));
  const blockedCap = usedCaptions(f, [...history.captions, ...reserved.map(r => r.caption)]);
  const imageKeys = P.pickImages(pool, blockedImg, f.s.imagesPerPost);
  const caption = P.pickUnused(f.captions, blockedCap);
  if (!imageKeys.length && !caption) return { ok: false, error: 'Đã dùng hết ảnh và caption trong thư mục' };
  // Mỗi bài imagesPerPost ảnh: ảnh thường giữ nguyên, ảnh ghép thì cắt đúng các ô đã chọn
  const files = [];
  const labels = [];
  for (const imageKey of imageKeys) {
    const entry = pool.find(e => e.key === imageKey);
    const file = f.images.find(i => i.name === entry.name);
    const ext = entry.name.split('.').pop().toLowerCase();
    const mime = MIME[ext] || 'image/jpeg';
    if (entry.tile) {
      const base64 = (await offscreen('CROP', f.folderUrl + file.href, { mime, rect: entry.rect })).base64;
      files.push({ name: `${entry.name.replace(/\.[^.]+$/, '')}-${String(entry.tile).padStart(2, '0')}.jpg`, mime: 'image/jpeg', base64 });
      labels.push(`ô ${entry.tile}/${entry.of} của ${entry.name}`);
    } else {
      files.push({ name: entry.name, mime, base64: (await offscreen('READ_BINARY', f.folderUrl + file.href)).base64 });
      labels.push(entry.name);
    }
  }
  const label = labels.join(', ');
  const want = f.s.imagesPerPost;
  const token = crypto.randomUUID();
  const saved = (await chrome.storage.local.get('reserved')).reserved || [];
  saved.push({ token, folderUrl: f.folderUrl, shared: f.shared, images: imageKeys, caption, at: Date.now() });
  await chrome.storage.local.set({ reserved: saved.filter(r => Date.now() - r.at < RESERVE_MS) });
  // item: trang Facebook giữ lại bản sao, gửi kèm khi bấm Đăng → vẫn ghi được dù giữ chỗ đã quá 10 phút
  return { ok: true, token, caption, image: label, files, item: { folderUrl: f.folderUrl, shared: f.shared, images: imageKeys, caption },
    warnings: [!imageKeys.length ? 'Hết ảnh chưa dùng' : imageKeys.length < want && `Chỉ còn ${imageKeys.length}/${want} ảnh chưa dùng`, !caption && 'Hết caption chưa dùng'].filter(Boolean) };
}

async function finish(token, used, fallback) {
  const all = (await chrome.storage.local.get('reserved')).reserved || [];
  const item = all.find(r => r.token === token) || (used && fallback?.folderUrl ? fallback : null);
  await chrome.storage.local.set({ reserved: all.filter(r => r.token !== token) });
  if (!item || !used) return { ok: true, released: Boolean(item) };
  const { key, history } = await loadState(item.folderUrl);
  for (const img of itemImages(item)) if (!history.images.includes(img)) history.images.push(img);
  if (item.caption && !history.captions.includes(item.caption)) history.captions.push(item.caption);
  await chrome.storage.local.set({ [key]: history });
  // Thư mục chung → ghi file đánh dấu để các profile khác không đăng lại
  let markError = '';
  if (item.shared) { try { await writeMarkers(item.shared, item); } catch (err) { markError = err.message; } }
  return { ok: true, image: itemImages(item).join(', '), caption: item.caption, markError };
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
    USED: () => finish(msg.token, true, msg.item),
    RELEASE: () => finish(msg.token, false),
    STATUS: () => status(),
    PREPARE: async () => {
      const s = await settings();
      return { ok: true, packageDir: P.packageDir(s.folder), delaySeconds: s.delaySeconds, enabled: s.enabled };
    },
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
