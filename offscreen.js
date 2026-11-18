// offscreen.js — Đọc file trên máy qua file:/// (chỉ trang extension dùng XHR mới đọc được; fetch() không hỗ trợ file:).
// Cần bật "Allow access to file URLs" cho extension.
function xhr(url, responseType = 'text') {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('GET', url, true);
    req.responseType = responseType;
    req.onload = () => (req.status === 0 || req.status === 200)
      ? resolve(req.response)
      : reject(new Error(`Không đọc được ${url} (HTTP ${req.status})`));
    req.onerror = () => reject(new Error(`Không đọc được ${decodeURI(url)}. Hãy bật "Allow access to file URLs" cho extension và kiểm tra đường dẫn trong settings.json.`));
    req.send();
  });
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function decode(url, mime) {
  const buffer = await xhr(url, 'arraybuffer');
  return createImageBitmap(new Blob([buffer], { type: mime }));
}

// Dò đường kẻ khung → tọa độ các ô ([] nếu không phải ảnh ghép)
async function analyze(url, mime) {
  const bitmap = await decode(url, mime);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return self.FbAutoSplitter.findTiles(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
  } finally {
    bitmap.close();
  }
}

// Cắt 1 ô thành ảnh JPEG riêng
async function crop(url, mime, rect) {
  const bitmap = await decode(url, mime);
  try {
    const piece = new OffscreenCanvas(rect.w, rect.h);
    piece.getContext('2d').drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const blob = await piece.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    return toBase64(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  (async () => {
    if (msg.type === 'LIST_DIR') return { html: await xhr(msg.url) };
    if (msg.type === 'READ_TEXT') return { text: await xhr(msg.url) };
    if (msg.type === 'READ_BINARY') return { base64: toBase64(await xhr(msg.url, 'arraybuffer')) };
    if (msg.type === 'ANALYZE') return { tiles: await analyze(msg.url, msg.mime) };
    if (msg.type === 'CROP') return { base64: await crop(msg.url, msg.mime, msg.rect) };
    throw new Error('Lệnh offscreen không hợp lệ');
  })().then(data => sendResponse({ ok: true, ...data }), err => sendResponse({ ok: false, error: err.message }));
  return true;
});
