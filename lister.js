// lister.js — Quét thư mục ảnh trong extension, báo kết quả cho trang cha (content script) qua postMessage.
(async () => {
  const dir = new URLSearchParams(location.search).get('dir') || 'anh';
  let msg;
  try {
    const files = await self.FbAutoPackageDir.scanAndStore(dir);
    msg = { fbAutoListed: true, ok: true, count: files.length };
  } catch (err) {
    msg = { fbAutoListed: true, ok: false, error: err.message };
  }
  parent.postMessage(msg, '*');
})();
