// content.js — Phát hiện hộp "Create post / Tạo bài viết" trên Facebook, tự điền 1 caption + 1 ảnh chưa dùng.
// Không tự bấm Post. Chỉ ghi "đã dùng" khi người dùng bấm Post; đóng hộp thì trả ảnh/caption lại.
(function () {
  if (window.__fbAutoPhotoLoaded) return;
  window.__fbAutoPhotoLoaded = true;

  const TITLES = /^(Create post|Tạo bài viết|Tạo bài viết công khai)$/i;
  const POST_LABELS = /^(Post|Đăng|Đăng bài)$/i;
  const handled = new WeakSet();
  // editor (ô soạn bài) → { token, done }. Facebook thay ô soạn bài mới khi xóa nháp, nên theo dõi theo editor chứ không theo hộp
  const sessions = new Map();

  const send = msg => new Promise(resolve => {
    try { chrome.runtime.sendMessage(msg, res => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : res)); }
    catch (err) { resolve({ ok: false, error: err.message }); }
  });

  function toast(text, isError = false) {
    let el = document.getElementById('fb-auto-photo-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fb-auto-photo-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;max-width:520px;padding:10px 16px;border-radius:10px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none;transition:opacity .3s';
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.background = isError ? '#b91c1c' : '#111827';
    el.style.color = '#fff';
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, isError ? 7000 : 3500);
  }

  // Hộp Create post: có tiêu đề đúng + ô soạn bài Lexical
  function findComposer(dialog) {
    const title = [...dialog.querySelectorAll('h1,h2,h3,[role="heading"]')].some(h => TITLES.test(h.innerText.trim()));
    if (!title) return null;
    const editor = dialog.querySelector('[contenteditable="true"][role="textbox"]');
    const input = dialog.querySelector('input[type="file"][accept*="image"]');
    return editor ? { editor, input } : null;
  }

  function isEmpty(editor) {
    return !editor.innerText.replace(/\s+/g, '');
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const hasText = (editor, text) => editor.innerText.replace(/\s+/g, ' ').includes(text.replace(/\s+/g, ' ').slice(0, 12));

  // Lexical cập nhật ô soạn bài bất đồng bộ → chèn xong phải đợi rồi mới kiểm tra, tránh chèn 2 lần
  async function insertCaption(editor, text) {
    editor.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text);
    for (let i = 0; i < 10 && !hasText(editor, text); i++) await wait(100);
    if (hasText(editor, text)) return true;
    // Dự phòng: giả lập dán chữ (Lexical xử lý sự kiện paste) — chỉ khi chưa có chữ nào
    if (!isEmpty(editor)) return false;
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    for (let i = 0; i < 10 && !hasText(editor, text); i++) await wait(100);
    return hasText(editor, text);
  }

  // Gắn 1 hoặc nhiều ảnh (ảnh ghép đã cắt) vào ô chọn ảnh của hộp Create post trong 1 lần
  function attachImages(input, files) {
    const dt = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      dt.items.add(new File([bytes], file.name, { type: file.mime, lastModified: Date.now() }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Thư mục ảnh nằm trong extension → nhúng tạm lister.html (trang extension) để quét lại file trước khi chọn ảnh
  function scanPackageDir(dir) {
    return new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.src = chrome.runtime.getURL(`lister.html?dir=${encodeURIComponent(dir)}`);
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
      const done = result => { window.removeEventListener('message', onMsg); frame.remove(); clearTimeout(timer); resolve(result); };
      const onMsg = ev => { if (ev.source === frame.contentWindow && ev.data?.fbAutoListed) done(ev.data); };
      const timer = setTimeout(() => done({ ok: false, error: 'Quét thư mục ảnh quá lâu' }), 15000);
      window.addEventListener('message', onMsg);
      document.documentElement.appendChild(frame);
    });
  }

  async function fill(dialog, composer) {
    const prep = await send({ type: 'PREPARE' });
    if (prep?.packageDir) {
      const scanned = await scanPackageDir(prep.packageDir);
      if (!scanned.ok) { toast(`FB Auto Ảnh: ${scanned.error}`, true); return; }
    }
    const res = await send({ type: 'NEXT' });
    if (!res?.ok) { toast(`FB Auto Ảnh: ${res?.error || 'không lấy được ảnh/caption'}`, true); return; }
    if (!document.contains(composer.editor) || !isEmpty(composer.editor)) {
      // Hộp đã đóng hoặc người dùng đã tự gõ trong lúc chờ → trả lại
      send({ type: 'RELEASE', token: res.token });
      return;
    }
    sessions.set(composer.editor, { token: res.token, done: false });
    const parts = [];
    if (res.caption) parts.push((await insertCaption(composer.editor, res.caption)) ? 'caption' : 'caption (lỗi chèn)');
    if (res.files?.length) {
      const input = composer.input || dialog.querySelector('input[type="file"][accept*="image"]');
      if (input) {
        attachImages(input, res.files);
        parts.push(`ảnh ${res.image}`);
      } else parts.push('ảnh (không thấy ô chọn ảnh)');
    }
    const warn = res.warnings?.length ? ` · ${res.warnings.join(', ')}` : '';
    toast(`FB Auto Ảnh: đã điền ${parts.join(' + ')}${warn}. Kiểm tra rồi bấm Post.`, Boolean(warn));
  }

  // Bấm Post trong hộp → ghi "đã dùng"
  document.addEventListener('click', ev => {
    const btn = ev.target.closest?.('[role="button"],button,[aria-label]');
    if (!btn) return;
    const label = (btn.getAttribute('aria-label') || btn.innerText || '').trim();
    if (!POST_LABELS.test(label) || btn.getAttribute('aria-disabled') === 'true') return;
    const dialog = btn.closest('[role="dialog"]');
    if (!dialog) return;
    for (const [editor, s] of sessions) {
      if (!s.done && dialog.contains(editor)) {
        s.done = true;
        send({ type: 'USED', token: s.token }).then(r => {
          if (r?.markError) toast(`FB Auto Ảnh: đã đăng nhưng chưa đánh dấu được cho profile khác — ${r.markError}`, true);
        });
      }
    }
  }, true);

  function scan() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const composer = findComposer(dialog);
      if (!composer || handled.has(composer.editor) || !isEmpty(composer.editor)) continue;
      handled.add(composer.editor);
      fill(dialog, composer);
    }
    // Ô soạn bài biến mất (đóng hộp / xóa nháp) mà chưa bấm Post → trả ảnh/caption lại để dùng sau
    for (const [editor, s] of sessions) {
      if (!document.contains(editor)) {
        if (!s.done) send({ type: 'RELEASE', token: s.token });
        sessions.delete(editor);
      }
    }
  }

  let timer = null;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 300); })
    .observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
