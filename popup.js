// popup.js — Xem thư mục đang dùng, số ảnh/caption còn lại, làm mới lịch sử.
const app = document.getElementById('app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const send = msg => new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));

async function render() {
  // Thư mục ảnh nằm trong extension: popup là trang extension nên tự quét được
  const prep = await send({ type: 'PREPARE' });
  if (prep?.packageDir) {
    try { await self.FbAutoPackageDir.scanAndStore(prep.packageDir); }
    catch (err) { app.innerHTML = `<div class="err">${esc(err.message)}</div>`; return; }
  }
  const s = await send({ type: 'STATUS' });
  const where = s?.shared ? `thư mục chung <b>${esc(s.sharedPath)}</b>`
    : prep?.packageDir ? `thư mục <b>${esc(prep.packageDir)}</b> trong extension` : esc(s?.folder || '—');
  const folder = `<div><div class="muted">Ảnh + caption lấy từ</div><div>${where}</div></div>`;
  if (!s?.ok) {
    app.innerHTML = folder + `<div class="err">${esc(s?.error || 'Không đọc được thư mục')}</div>`;
    return;
  }
  const left = x => x.total - x.used;
  app.innerHTML = folder + `
    ${s.enabled ? '' : '<div class="off">Đang tắt: đặt "enabled": true trong settings.json để bật.</div>'}
    <div class="row"><span>Ảnh còn lại</span><span class="pill">${left(s.images)}/${s.images.total}</span></div>
    <div class="row"><span>Caption còn lại <span class="muted">(${esc(s.captionFile || 'chưa có .txt')})</span></span><span class="pill">${left(s.captions)}/${s.captions.total}</span></div>
    <div class="muted">${s.files} file ảnh${s.splitCollage ? ` · ${s.collages} ảnh ghép đã cắt thành ${s.tiles} ô (mỗi ô là 1 ảnh, mỗi bài đăng 1 ảnh)` : ' · không cắt ảnh ghép'}</div>
    ${s.shared ? `<div class="muted">Dùng chung cho mọi profile: ${s.sharedMarked} ảnh/caption đã đăng được đánh dấu trong <b>da-dang/</b>. Xóa file trong đó để dùng lại.</div>` : ''}
    ${s.reserved ? `<div class="muted">${s.reserved} bộ đang được giữ trong hộp Create post chưa đăng.</div>` : ''}
    <button id="reset">Làm mới lịch sử${s.shared ? ' của profile này' : ' (dùng lại từ đầu)'}</button>`;
  document.getElementById('reset').onclick = async () => {
    if (!confirm('Xóa lịch sử đã dùng của thư mục này? Ảnh và caption sẽ được dùng lại từ đầu.')) return;
    await send({ type: 'RESET' });
    render();
  };
}
render();
