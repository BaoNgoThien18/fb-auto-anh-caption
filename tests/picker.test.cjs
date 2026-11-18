const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/picker.js');

test('folderToFileUrl: Mac, Windows (cả \\ và /), có dấu cách & tiếng Việt', () => {
  assert.equal(P.folderToFileUrl('/Users/mac/Desktop/fb-auto-photo-mau'), 'file:///Users/mac/Desktop/fb-auto-photo-mau/');
  assert.equal(P.folderToFileUrl('D:\\Anh\\Bai dang'), 'file:///D:/Anh/Bai%20dang/');
  assert.equal(P.folderToFileUrl('D:/Ảnh'), 'file:///D:/%E1%BA%A2nh/');
  assert.equal(P.folderToFileUrl('file:///C:/x'), 'file:///C:/x/');
  assert.equal(P.folderToFileUrl(''), '');
});

// Trích từ trang liệt kê thư mục của Chrome (file:///…/)
const listing = `
<script>start("/Users/mac/Desktop/fb-auto-photo-mau/");</script>
<script>addRow("..","..",1,0,"0 B",0,"");</script>
<script>addRow("sub","sub",1,0,"0 B",1700000000,"11/18/26");</script>
<script>addRow("anh-01.png","anh-01.png",0,3674,"3.6 kB",1700000000,"11/18/26");</script>
<script>addRow("ảnh mẫu 03.png","%E1%BA%A3nh%20m%E1%BA%ABu%2003.png",0,3470,"3.4 kB",1700000000,"11/18/26");</script>
<script>addRow("captions.txt","captions.txt",0,238,"238 B",1700000000,"11/18/26");</script>
<script>addRow(".DS_Store",".DS_Store",0,6148,"6.0 kB",1700000000,"11/18/26");</script>
<script>addRow("notes.TXT","notes.TXT",0,10,"10 B",1700000000,"11/18/26");</script>`;

test('parseDirListing bỏ thư mục con, "..", file ẩn; giữ tên gốc + href đã mã hóa', () => {
  const files = P.parseDirListing(listing);
  assert.deepEqual(files.map(f => f.name), ['anh-01.png', 'ảnh mẫu 03.png', 'captions.txt', 'notes.TXT']);
  assert.equal(files[1].href, '%E1%BA%A3nh%20m%E1%BA%ABu%2003.png');
  assert.deepEqual(P.imageFiles(files).map(f => f.name), ['anh-01.png', 'ảnh mẫu 03.png']);
});

test('captionFile ưu tiên tên trong settings, không có thì lấy .txt đầu tiên', () => {
  const files = P.parseDirListing(listing);
  assert.equal(P.captionFile(files, 'NOTES.txt').name, 'notes.TXT');
  assert.equal(P.captionFile(files, 'khong-co.txt').name, 'captions.txt');
  assert.equal(P.captionFile([], 'x.txt'), null);
});

test('parseCaptions: mỗi dòng 1 caption, bỏ dòng trống, BOM, dòng trùng; hỗ trợ \\r\\n', () => {
  const text = '\uFEFFChào buổi sáng 🌞\r\nHôm nay đẹp\r\n\r\n  Chào buổi sáng 🌞  \nCà phê ☕\n';
  assert.deepEqual(P.parseCaptions(text), ['Chào buổi sáng 🌞', 'Hôm nay đẹp', 'Cà phê ☕']);
});

test('pickUnused: không bao giờ trả lại phần tử đã dùng/giữ chỗ; hết thì null', () => {
  const items = ['a', 'b', 'c', 'd'];
  const used = new Set();
  for (let i = 0; i < items.length; i++) {
    const pick = P.pickUnused(items, used);
    assert.ok(items.includes(pick) && !used.has(pick));
    used.add(pick);
  }
  assert.equal(P.pickUnused(items, used), null);
  assert.equal(P.pickUnused(items, ['a', 'b', 'c'], () => 0.99), 'd');
  assert.equal(P.pickUnused(items, [], () => 0), 'a');
  assert.equal(P.pickUnused(items, [], () => 0.9999), 'd');
});

test('parseDirListing đọc thêm size + ngày sửa (chữ ký file)', () => {
  const html = '<script>addRow("ghep-1.webp","ghep-1.webp",0,186972,"183 kB",1794977000,"11/18/26, 12:00:00 PM");</script>';
  assert.deepEqual(P.parseDirListing(html), [{ name: 'ghep-1.webp', href: 'ghep-1.webp', size: 186972, mtime: 1794977000 }]);
});

const rect = i => ({ x: i * 10, y: 0, w: 9, h: 9 });
const images = [
  { name: 'a.png', href: 'a.png', size: 1, mtime: 1 },
  { name: 'ghep.webp', href: 'ghep.webp', size: 5, mtime: 7 },
];

test('buildPool: ảnh ghép → mỗi ô 1 mục "tên#NN", ảnh thường 1 mục', () => {
  const pool = P.buildPool(images, { 'ghep.webp': { sig: '5:7', tiles: [0, 1, 2].map(rect) } });
  assert.deepEqual(pool.map(e => e.key), ['a.png', 'ghep.webp#01', 'ghep.webp#02', 'ghep.webp#03']);
  assert.deepEqual(pool[2], { key: 'ghep.webp#02', name: 'ghep.webp', tile: 2, of: 3, rect: rect(1) });
});

test('buildPool: file đổi (chữ ký khác) hoặc chưa phân tích → coi là ảnh thường', () => {
  assert.deepEqual(P.buildPool(images, { 'ghep.webp': { sig: '5:8', tiles: [0, 1].map(rect) } }).map(e => e.key), ['a.png', 'ghep.webp']);
  assert.deepEqual(P.buildPool(images, {}).map(e => e.key), ['a.png', 'ghep.webp']);
});

test('chọn lần lượt: mỗi lần 1 ô, không bao giờ trùng ô; ảnh gốc đã dùng nguyên thì chặn hết ô', () => {
  const pool = P.buildPool(images, { 'ghep.webp': { sig: '5:7', tiles: [0, 1, 2].map(rect) } });
  const used = [];
  for (let i = 0; i < pool.length; i++) {
    const key = P.pickUnused(pool.map(e => e.key), P.blockedKeys(pool, used));
    assert.ok(key && !used.includes(key));
    used.push(key);
  }
  assert.equal(P.pickUnused(pool.map(e => e.key), P.blockedKeys(pool, used)), null);
  assert.deepEqual([...P.blockedKeys(pool, ['ghep.webp'])], ['ghep.webp#01', 'ghep.webp#02', 'ghep.webp#03']);
});

test('pickImages: 2 ảnh/bài, ưu tiên ô cùng ảnh ghép, không trùng, kho sắp hết thì trả ít hơn', () => {
  const pool = P.buildPool(
    [{ name: 'ghep.jpg', size: 1, mtime: 1 }, { name: 'don.jpg', size: 2, mtime: 2 }],
    { 'ghep.jpg': { sig: '1:1', tiles: [{}, {}, {}] } },
  );
  // ghep.jpg#01..03 + don.jpg
  const first0 = () => 0;
  assert.deepEqual(P.pickImages(pool, [], 2, first0), ['ghep.jpg#01', 'ghep.jpg#02']);
  // Ô cùng bộ đã dùng hết 2 → ô còn lại + sang ảnh khác
  assert.deepEqual(P.pickImages(pool, ['ghep.jpg#01', 'ghep.jpg#02'], 2, first0), ['ghep.jpg#03', 'don.jpg']);
  // Ảnh đơn trước → lấy thêm ảnh khác
  assert.deepEqual(P.pickImages(pool, ['ghep.jpg#01', 'ghep.jpg#02', 'ghep.jpg#03'], 2, first0), ['don.jpg']);
  assert.deepEqual(P.pickImages(pool, pool.map(e => e.key), 2), []);
  for (let i = 0; i < 50; i++) {
    const keys = P.pickImages(pool, [], 2);
    assert.equal(new Set(keys).size, 2);
    assert.equal(keys.every(k => k.startsWith('ghep')) || keys.includes('don.jpg'), true);
  }
});

test('giữ chỗ giữa các profile: tên file, đọc lại, hết hạn, xung đột', () => {
  const now = 1_800_000_000_000, ttl = 600_000;
  const name = P.holdName({ at: now, owner: 'p1', images: ['ghep.jpg#01', 'ghep.jpg#02'], caption: 'Chào cả nhà' });
  assert.match(name, /^giu_1800000000000_p1_a[0-9a-f]{10}_a[0-9a-f]{10}_c[0-9a-f]{10}\.txt$/);
  const [h] = P.parseHolds([name, 'README.txt'], now + 1000, ttl);
  assert.equal(h.owner, 'p1');
  assert.ok(h.anh.has(P.stableHash('ghep.jpg#02')) && h.cap.has(P.stableHash('Chào cả nhà')));
  assert.equal(P.parseHolds([name], now + ttl + 1, ttl).length, 0, 'quá 10 phút thì bỏ');
  const mine = P.parseHolds([P.holdName({ at: now + 50, owner: 'p2', images: ['ghep.jpg#02'] })], now, ttl)[0];
  assert.equal(P.holdConflict(mine, [h]), true, 'p1 giữ trước → p2 phải chọn lại');
  assert.equal(P.holdConflict(h, [mine]), false, 'p1 giữ trước thì không phải nhường');
  const other = P.parseHolds([P.holdName({ at: now + 50, owner: 'p2', images: ['don.jpg'] })], now, ttl)[0];
  assert.equal(P.holdConflict(other, [h]), false, 'khác ảnh thì không xung đột');
});
