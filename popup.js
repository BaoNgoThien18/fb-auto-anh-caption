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
  const askFix = '<button id="open-dl">Mở cài đặt Tải xuống của Chrome</button>';
  const bindAskFix = () => {
    const b = document.getElementById('open-dl');
    if (b) b.onclick = () => chrome.tabs.create({ url: 'chrome://settings/downloads' });
  };
  if (!s?.ok) {
    const ask = /Hỏi vị trí lưu/.test(s?.error || '');
    app.innerHTML = folder + `<div class="err">${esc(s?.error || 'Không đọc được thư mục')}</div>` + (ask ? askFix : '');
    bindAskFix();
    return;
  }
  const left = x => x.total - x.used;
  app.innerHTML = folder + `
    ${s.askWarned ? `<div class="off">Chrome đang bật <b>"Hỏi vị trí lưu từng tệp trước khi tải xuống"</b> → mỗi lần bấm Đăng sẽ hiện hộp lưu file. Hãy tắt mục đó.</div>${askFix}` : ''}
    ${s.enabled ? '' : '<div class="off">Đang tắt: đặt "enabled": true trong settings.json để bật.</div>'}
    <div class="row"><span>Ảnh còn lại</span><span class="pill">${left(s.images)}/${s.images.total}</span></div>
    <div class="row"><span>Caption còn lại <span class="muted">(${esc(s.captionFile || 'chưa có .txt')})</span></span><span class="pill">${left(s.captions)}/${s.captions.total}</span></div>
    <div class="muted">${s.files} file ảnh${s.splitCollage ? ` · ${s.collages} ảnh ghép đã cắt thành ${s.tiles} ô (mỗi ô là 1 ảnh)` : ' · không cắt ảnh ghép'} · <b>mỗi bài ${s.imagesPerPost} ảnh</b></div>
    ${s.shared ? `<div class="muted">Dùng chung cho mọi profile: ${s.sharedMarked} ảnh/caption đã đăng được đánh dấu trong <b>da-dang/</b>. Xóa file trong đó để dùng lại.</div>` : ''}
    ${s.reserved ? `<div class="muted">${s.reserved} bộ đang được giữ trong hộp Create post chưa đăng.</div>` : ''}
    ${s.heldByOthers ? `<div class="muted">${s.heldByOthers} bộ đang được profile khác giữ (đang mở hộp tạo bài) — profile này sẽ không lấy trùng.</div>` : ''}
    <button id="reset">Làm mới lịch sử${s.shared ? ' của profile này' : ' (dùng lại từ đầu)'}</button>`;
  bindAskFix();
  document.getElementById('reset').onclick = async () => {
    if (!confirm('Xóa lịch sử đã dùng của thư mục này? Ảnh và caption sẽ được dùng lại từ đầu.')) return;
    await send({ type: 'RESET' });
    render();
  };
}
render();
