// lib/picker.js — Logic thuần (không phụ thuộc trình duyệt) để đọc thư mục, đọc caption và chọn ngẫu nhiên không trùng.
// Dùng chung cho background, offscreen và test Node.
(function (root) {
  const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

  // Đường dẫn thư mục (Mac: /Users/..., Windows: D:\Anh hoặc D:/Anh) → URL file:/// có dấu / ở cuối
  function folderToFileUrl(folder) {
    let p = String(folder || '').trim().replace(/\\/g, '/');
    if (!p) return '';
    if (/^file:\/\//i.test(p)) return p.endsWith('/') ? p : p + '/';
    if (/^[a-zA-Z]:\//.test(p)) p = '/' + p; // D:/Anh → /D:/Anh
    if (!p.startsWith('/')) p = '/' + p;
    const encoded = p.split('/').map((seg, i) => (i === 1 && /^[a-zA-Z]:$/.test(seg)) ? seg : encodeURIComponent(seg)).join('/');
    return 'file://' + (encoded.endsWith('/') ? encoded : encoded + '/');
  }

  // Trang liệt kê thư mục của Chrome có các dòng: addRow("tên","tên-mã-hóa",isDir,size,"size",date,"date");
  // size + date dùng làm "chữ ký" file để nhớ kết quả cắt ảnh ghép (file đổi thì cắt lại)
  function parseDirListing(html) {
    const files = [];
    const re = /addRow\("((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)",(\d),(\d+),"(?:[^"\\]|\\.)*",(\d+)/g;
    let m;
    while ((m = re.exec(String(html || '')))) {
      if (m[3] === '1') continue; // thư mục con
      let name = m[1];
      try { name = JSON.parse(`"${m[1]}"`); } catch (_) {}
      if (name === '..' || name.startsWith('.')) continue;
      files.push({ name, href: m[2], size: Number(m[4]), mtime: Number(m[5]) });
    }
    return files;
  }

  function imageFiles(files) {
    return files.filter(f => IMAGE_EXT.test(f.name)); // thứ tự không quan trọng vì chọn ngẫu nhiên
  }

  // File caption ưu tiên tên trong settings; không có thì lấy file .txt đầu tiên
  function captionFile(files, wanted) {
    const txt = files.filter(f => /\.txt$/i.test(f.name));
    if (wanted) {
      const exact = txt.find(f => f.name.toLowerCase() === String(wanted).toLowerCase());
      if (exact) return exact;
    }
    return txt.sort((a, b) => a.name.localeCompare(b.name))[0] || null;
  }

  // Mỗi dòng không rỗng là 1 caption; bỏ BOM, bỏ dòng trùng y hệt
  function parseCaptions(text) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
    return out;
  }

  // Chọn ngẫu nhiên 1 phần tử chưa nằm trong `blocked` (đã dùng hoặc đang giữ chỗ). Hết thì trả null.
  function pickUnused(items, blocked, random = Math.random) {
    const block = blocked instanceof Set ? blocked : new Set(blocked || []);
    const free = items.filter(item => !block.has(item));
    if (!free.length) return null;
    return free[Math.min(free.length - 1, Math.floor(random() * free.length))];
  }

  const fileSig = f => `${f.size || 0}:${f.mtime || 0}`;

  // Kho ảnh: ảnh thường = 1 mục (key = tên file); ảnh ghép = mỗi ô 1 mục (key = "tên#03").
  // tileMap: { tênFile: { sig, tiles: [{x,y,w,h}] } } — kết quả dò đường kẻ đã nhớ.
  function buildPool(images, tileMap = {}) {
    const pool = [];
    for (const img of images) {
      const cached = tileMap[img.name];
      const tiles = cached && cached.sig === fileSig(img) ? cached.tiles : [];
      if (tiles.length >= 2) {
        tiles.forEach((rect, i) => pool.push({ key: `${img.name}#${String(i + 1).padStart(2, '0')}`, name: img.name, tile: i + 1, of: tiles.length, rect }));
      } else {
        pool.push({ key: img.name, name: img.name, tile: 0, of: 1, rect: null });
      }
    }
    return pool;
  }

  // Ô của ảnh ghép cũng bị chặn nếu cả ảnh gốc đã từng được dùng nguyên (lịch sử trước khi cắt từng ô)
  function blockedKeys(pool, usedKeys) {
    const used = usedKeys instanceof Set ? usedKeys : new Set(usedKeys || []);
    return new Set(pool.filter(e => used.has(e.key) || (e.tile && used.has(e.name))).map(e => e.key));
  }

  // "Downloads/fb-anh" → thư mục CHUNG trong Downloads: mọi profile dùng chung + chống trùng qua thư mục da-dang/
  function sharedDir(folder) {
    const p = String(folder || '').trim().replace(/\\/g, '/');
    const m = p.match(/^downloads\/+(.+?)\/*$/i);
    if (!m || m[1].split('/').includes('..')) return '';
    return m[1];
  }

  // "anh", "anh/bai-dang" → thư mục nằm trong extension. Đường dẫn tuyệt đối (/..., C:/..., file://) → thư mục trên máy.
  function packageDir(folder) {
    const p = String(folder || '').trim().replace(/\\/g, '/');
    if (!p || sharedDir(p) || p.startsWith('/') || /^[a-zA-Z]:\//.test(p) || /^file:/i.test(p) || p.split('/').includes('..')) return '';
    return p.replace(/^\.\//, '').replace(/\/+$/, '');
  }

  // Mã băm ổn định (giống nhau ở mọi profile/máy) cho tên ảnh/ô ảnh/caption — 10 ký tự hex
  function stableHash(text) {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
    const str = String(text);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 10);
  }

  // Tên file đánh dấu trong da-dang/: "anh_<tên dễ đọc>_<hash>.txt" / "cap_<đầu caption>_<hash>.txt"
  // Người dùng xóa file này = cho phép dùng lại ảnh/caption đó.
  function markerName(kind, text) {
    const readable = String(text).normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
    return `${kind}_${readable}_${stableHash(text)}.txt`;
  }

  function parseMarkers(names) {
    const out = { anh: new Set(), cap: new Set() };
    for (const name of names) {
      const m = String(name).match(/^(anh|cap)_.*_([0-9a-f]{10})\.txt$/);
      if (m) out[m[1]].add(m[2]);
    }
    return out;
  }

  const api = { IMAGE_EXT, sharedDir, stableHash, markerName, parseMarkers, packageDir, folderToFileUrl, parseDirListing, imageFiles, captionFile, parseCaptions, pickUnused, fileSig, buildPool, blockedKeys };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FbAutoPicker = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
