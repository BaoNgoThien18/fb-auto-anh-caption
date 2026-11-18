const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/splitter.js');

// Tạo ảnh RGBA đơn giản: nền màu `bg`, rồi vẽ các hình chữ nhật
function makeImage(w, h, bg, rects = []) {
  const data = new Uint8ClampedArray(w * h * 4);
  const fill = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  };
  fill(0, 0, w, h, bg);
  for (const r of rects) fill(r.x0, r.y0, r.x1, r.y1, r.c);
  return { width: w, height: h, data };
}

// Ảnh ghép rows×cols: viền ngoài + đường kẻ trắng dày `gap`, mỗi ô màu tối khác nhau
function collage(rows, cols, tw, th, gap, extra = []) {
  const w = cols * tw + (cols + 1) * gap, h = rows * th + (rows + 1) * gap;
  const rects = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = gap + c * (tw + gap), y0 = gap + r * (th + gap);
    rects.push({ x0, y0, x1: x0 + tw, y1: y0 + th, c: [30 + c * 20, 40 + r * 30, 80] });
  }
  return makeImage(w, h, [255, 255, 255], rects.concat(extra));
}

test('ảnh ghép 5×2 có đường kẻ trắng → 10 ô đúng vị trí, thứ tự trái→phải, trên→dưới', () => {
  const img = collage(2, 5, 200, 300, 6);
  const tiles = S.findTiles(img);
  assert.equal(tiles.length, 10);
  assert.deepEqual(tiles[0], { x: 7, y: 7, w: 198, h: 298 });
  assert.deepEqual(tiles[1], { x: 213, y: 7, w: 198, h: 298 });
  assert.deepEqual(tiles[5], { x: 7, y: 313, w: 198, h: 298 });
  assert.ok(tiles.every(t => t.w === 198 && t.h === 298));
});

test('mảng trắng lớn bên trong 1 ô (tường trắng) không bị cắt nhầm', () => {
  // Ô (0,0) có mảng trắng chiếm 70% chiều cao — không phủ hết dải nên không thành đường kẻ
  const img = collage(2, 5, 200, 300, 6, [{ x0: 40, y0: 6, x1: 140, y1: 216, c: [255, 255, 255] }]);
  assert.equal(S.findTiles(img).length, 10);
});

test('đường kẻ xám nhạt (#e8e8e8) và có khử răng cưa vẫn nhận', () => {
  const img = collage(1, 3, 300, 400, 4);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255) { d[i] = 232; d[i + 1] = 232; d[i + 2] = 232; }
  assert.equal(S.findTiles(img).length, 3);
});

test('ảnh thường (không có khung) → [] để đăng nguyên ảnh', () => {
  const img = makeImage(600, 800, [120, 90, 70], [{ x0: 100, y0: 100, x1: 500, y1: 700, c: [250, 250, 250] }]);
  assert.deepEqual(S.findTiles(img), []);
});

test('nền vàng/kem (tường) không bị coi là đường kẻ', () => {
  const img = collage(1, 2, 300, 400, 6);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i] === 255) { d[i] = 245; d[i + 1] = 222; d[i + 2] = 179; } // wheat
  assert.deepEqual(S.findTiles(img), []);
});
