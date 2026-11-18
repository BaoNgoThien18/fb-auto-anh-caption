const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/picker.js');

test('sharedDir: "Downloads/<tên>" là thư mục chung; không nhầm với thư mục trong extension / đường dẫn tuyệt đối', () => {
  assert.equal(P.sharedDir('Downloads/fb-anh'), 'fb-anh');
  assert.equal(P.sharedDir('downloads\\fb-anh\\bai'), 'fb-anh/bai');
  assert.equal(P.sharedDir('Downloads/../etc'), '');
  assert.equal(P.sharedDir('anh'), '');
  assert.equal(P.sharedDir('/Users/mac/Downloads/fb-anh'), '');
  assert.equal(P.packageDir('Downloads/fb-anh'), '');
  assert.equal(P.packageDir('anh'), 'anh');
});

test('stableHash: cố định (mọi profile ra cùng mã), 10 ký tự hex, khác nhau theo nội dung', () => {
  assert.equal(P.stableHash('ghep-1.webp#03'), P.stableHash('ghep-1.webp#03'));
  assert.match(P.stableHash('x'), /^[0-9a-f]{10}$/);
  assert.notEqual(P.stableHash('ghep-1.webp#03'), P.stableHash('ghep-1.webp#04'));
  assert.notEqual(P.stableHash('Chào'), P.stableHash('Chao'));
});

test('markerName dễ đọc, an toàn làm tên file; parseMarkers đọc lại đúng mã, bỏ file lạ', () => {
  const a = P.markerName('anh', 'ghep-1.webp#03');
  const c = P.markerName('cap', 'Chào buổi sáng cả nhà 🌞 / "test"');
  assert.match(a, /^anh_ghep-1\.webp-03_[0-9a-f]{10}\.txt$/);
  assert.match(c, /^cap_Chào-buổi-sáng-cả-nhà-test_[0-9a-f]{10}\.txt$/);
  assert.ok(!/[\\/:*?"<>|]/.test(c));
  const m = P.parseMarkers([a, c, 'README.txt', 'ghi-chu.txt', 'anh_x_ZZZ.txt']);
  assert.deepEqual([...m.anh], [P.stableHash('ghep-1.webp#03')]);
  assert.deepEqual([...m.cap], [P.stableHash('Chào buổi sáng cả nhà 🌞 / "test"')]);
});

test('caption rất dài vẫn cho tên file ngắn', () => {
  const name = P.markerName('cap', 'a'.repeat(500));
  assert.ok(name.length < 70);
});
