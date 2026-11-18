// lib/splitter.js — Tìm các ô ảnh trong ảnh ghép (collage) dựa vào đường kẻ khung màu sáng (trắng/xám nhạt).
// Thuần logic trên mảng pixel RGBA (ImageData), không phụ thuộc trình duyệt → test được bằng Node.
//
// Cách làm:
//   1. Tìm các HÀNG kẻ ngang: hàng pixel mà gần như toàn bộ chiều ngang là màu sáng → chia ảnh thành các dải.
//   2. Trong từng dải, tìm các CỘT kẻ dọc: cột pixel mà gần như toàn bộ chiều cao của dải là màu sáng.
//   3. Phần giữa các đường kẻ là 1 ô. Bỏ ô quá nhỏ (vụn do khử răng cưa ở mép kẻ).
(function (root) {
  const DEFAULTS = {
    light: 215,       // kênh màu thấp nhất ≥ ngưỡng này thì coi là "sáng"
    neutral: 40,      // chênh lệch giữa các kênh ≤ ngưỡng này (trắng/xám, không phải màu da/tường vàng)
    lineRatio: 0.9,   // ≥ 90% pixel của hàng/cột là sáng → là đường kẻ
    minTile: 0.08,    // ô phải ≥ 8% chiều tương ứng của ảnh
    minTilePx: 40,    // và ≥ 40px
    inset: 1,         // cắt lẹm vào 1px để bỏ viền khử răng cưa còn sót
  };

  function isLight(d, i, o) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lo = Math.min(r, g, b), hi = Math.max(r, g, b);
    return lo >= o.light && hi - lo <= o.neutral;
  }

  // Các đoạn [start, end) KHÔNG phải đường kẻ, theo một mảng boolean "là kẻ"
  function segments(isLine, minSize) {
    const out = [];
    let start = -1;
    for (let i = 0; i <= isLine.length; i++) {
      const line = i === isLine.length || isLine[i];
      if (!line && start < 0) start = i;
      if (line && start >= 0) {
        if (i - start >= minSize) out.push([start, i]);
        start = -1;
      }
    }
    return out;
  }

  // Hàng y trong khoảng cột [x0,x1) có phải đường kẻ ngang không
  function rowIsLine(img, y, x0, x1, o) {
    const d = img.data, w = img.width;
    let light = 0;
    for (let x = x0; x < x1; x++) if (isLight(d, (y * w + x) * 4, o)) light++;
    return light >= (x1 - x0) * o.lineRatio;
  }

  function colIsLine(img, x, y0, y1, o) {
    const d = img.data, w = img.width;
    let light = 0;
    for (let y = y0; y < y1; y++) if (isLight(d, (y * w + x) * 4, o)) light++;
    return light >= (y1 - y0) * o.lineRatio;
  }

  // Trả về danh sách ô { x, y, w, h } theo thứ tự đọc (trái→phải, trên→dưới). Không phải ảnh ghép → [].
  function findTiles(img, options = {}) {
    const o = { ...DEFAULTS, ...options };
    const { width: W, height: H } = img;
    const minW = Math.max(o.minTilePx, Math.round(W * o.minTile));
    const minH = Math.max(o.minTilePx, Math.round(H * o.minTile));

    const rowLines = Array.from({ length: H }, (_, y) => rowIsLine(img, y, 0, W, o));
    const bands = segments(rowLines, minH);
    const tiles = [];
    for (const [y0, y1] of bands) {
      const colLines = Array.from({ length: W }, (_, x) => colIsLine(img, x, y0, y1, o));
      for (const [x0, x1] of segments(colLines, minW)) {
        const x = x0 + o.inset, y = y0 + o.inset;
        tiles.push({ x, y, w: x1 - x0 - 2 * o.inset, h: y1 - y0 - 2 * o.inset });
      }
    }
    // Chỉ coi là ảnh ghép khi có ≥ 2 ô
    return tiles.length >= 2 ? tiles : [];
  }

  const api = { DEFAULTS, findTiles, segments };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FbAutoSplitter = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
