// lib/package-dir.js — Liệt kê file trong thư mục con NẰM TRONG extension (vd: "anh").
// Chỉ chạy được ở trang extension thường (popup, hoặc lister.html nhúng trong trang Facebook):
// chrome.runtime.getPackageDirectoryEntry không có ở service worker / offscreen.
(function (root) {
  const call = (fn, ...args) => new Promise((ok, bad) => fn(...args, ok, bad));

  async function listPackageDir(dir) {
    if (typeof chrome?.runtime?.getPackageDirectoryEntry !== 'function') throw new Error('Trang này không liệt kê được thư mục extension');
    const rootEntry = await new Promise(r => chrome.runtime.getPackageDirectoryEntry(r));
    let folder;
    try { folder = await call((p, o, ok, bad) => rootEntry.getDirectory(p, o, ok, bad), String(dir).replace(/^\/+|\/+$/g, ''), {}); }
    catch (_) { throw new Error(`Không thấy thư mục "${dir}" trong extension`); }
    const entries = [];
    const reader = folder.createReader();
    for (;;) {
      const batch = await call((ok, bad) => reader.readEntries(ok, bad));
      if (!batch.length) break;
      entries.push(...batch);
    }
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile || entry.name.startsWith('.')) continue;
      const file = await call((ok, bad) => entry.file(ok, bad));
      files.push({ name: entry.name, href: encodeURIComponent(entry.name), size: file.size, mtime: Math.floor(file.lastModified / 1000) });
    }
    return files;
  }

  // Quét rồi gửi cho background lưu lại (background không tự quét được)
  async function scanAndStore(dir) {
    const files = await listPackageDir(dir);
    const res = await new Promise(r => chrome.runtime.sendMessage({ type: 'PKG_LIST', dir, files }, r));
    if (!res?.ok) throw new Error(res?.error || 'Không lưu được danh sách file');
    return files;
  }

  root.FbAutoPackageDir = { listPackageDir, scanAndStore };
})(typeof globalThis !== 'undefined' ? globalThis : self);
