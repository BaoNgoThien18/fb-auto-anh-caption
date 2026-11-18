// content.js — Phát hiện hộp "Create post / Tạo bài viết" trên Facebook, tự điền 1 caption + 1 ảnh chưa dùng.
// Không tự bấm Post. Chỉ ghi "đã dùng" khi người dùng bấm Post; đóng hộp thì trả ảnh/caption lại.
(function () {
  // Extension vừa cài/tải lại sẽ tự chèn lại script vào tab Facebook đang mở; bản cũ (đã mất kết nối) thì nhường chỗ
  const alive = () => { try { return Boolean(chrome.runtime?.id); } catch { return false; } };
  if (window.__fbAutoPhotoAlive?.()) return;
  window.__fbAutoPhotoAlive = alive;

  // ===== Nhận hộp tạo bài THEO ELEMENT (không phụ thuộc ngôn ngữ Facebook) =====
  // Hộp tạo bài = [role=dialog] có:
  //   - ô soạn bài Lexical: [contenteditable=true][role=textbox][data-lexical-editor]
  //   - ô chọn file nhận cả ảnh + video, chọn nhiều file (nút "Ảnh/video" của hộp tạo bài)
  //   - KHÔNG có bài viết/bình luận ([role=article]) hay khung tin nhắn ([role=grid]/[role=row])
  const EDITOR = '[contenteditable="true"][role="textbox"]';
  const MEDIA_INPUT = 'input[type="file"][accept*="image"]';

  function mediaInput(dialog) {
    const inputs = [...dialog.querySelectorAll(MEDIA_INPUT)];
    return inputs.find(i => i.multiple && /video/.test(i.accept)) || null;
  }

  function findComposer(dialog) {
    if (dialog.querySelector('[role="article"],[role="grid"],[role="row"]')) return null;
    const editors = [...dialog.querySelectorAll(EDITOR)];
    const editor = editors.find(el => el.hasAttribute('data-lexical-editor')) || (editors.length === 1 ? editors[0] : null);
    if (!editor) return null;
    const input = mediaInput(dialog);
    if (!input) return null;
    return { editor, input };
  }

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
  // Đếm ngược trước khi điền: thanh nhỏ ở cuối màn hình (vòng xoay + số giây + thanh chạy + nút Hủy).
  // Tự hủy nếu đóng hộp hoặc người dùng tự gõ chữ. Trả về true khi hết giờ, false khi bị hủy.
  function countdown(seconds, editor) {
    return new Promise(resolve => {
      document.getElementById('fb-auto-photo-countdown')?.remove();
      const box = document.createElement('div');
      box.id = 'fb-auto-photo-countdown';
      box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;width:300px;padding:10px 12px 0;border-radius:12px;background:#111827;color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);overflow:hidden';
      box.innerHTML = `
        <style>@keyframes fbap-spin{to{transform:rotate(360deg)}}</style>
        <div style="display:flex;align-items:center;gap:10px;padding-bottom:10px">
          <span style="width:16px;height:16px;flex:none;border:2px solid rgba(255,255,255,.25);border-top-color:#60a5fa;border-radius:50%;animation:fbap-spin .8s linear infinite"></span>
          <span style="flex:1">Điền ảnh + caption sau <b data-left style="font-variant-numeric:tabular-nums">${seconds.toFixed(1)}</b>s</span>
          <button type="button" data-cancel style="all:unset;cursor:pointer;padding:2px 10px;border-radius:999px;background:rgba(255,255,255,.14);font-size:12px">Hủy</button>
        </div>
        <div style="height:3px;background:rgba(255,255,255,.12)"><div data-bar style="height:100%;width:100%;background:#60a5fa"></div></div>`;
      document.documentElement.appendChild(box);
      const left = box.querySelector('[data-left]');
      const bar = box.querySelector('[data-bar]');
      const total = seconds * 1000;
      const start = performance.now();
      let raf = 0;
      const finish = ok => { cancelAnimationFrame(raf); box.remove(); resolve(ok); };
      box.querySelector('[data-cancel]').addEventListener('click', () => { toast('FB Auto Ảnh: đã hủy điền cho hộp này'); finish(false); });
      const tick = now => {
        if (!editor.isConnected || !isEmpty(editor)) return finish(false); // đóng hộp / tự gõ chữ
        const remain = Math.max(0, total - (now - start));
        left.textContent = (remain / 1000).toFixed(1);
        bar.style.width = `${(remain / total) * 100}%`;
        if (remain <= 0) return finish(true);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
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
    if (prep?.enabled !== false && prep?.delaySeconds > 0 && !(await countdown(prep.delaySeconds, composer.editor))) return;
    if (!composer.editor.isConnected || !isEmpty(composer.editor)) return;
    toast('FB Auto Ảnh: đang lấy ảnh + caption…');
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
    sessions.set(composer.editor, { token: res.token, item: res.item, dialog, done: false, postedAt: 0 });
    const parts = [];
    if (res.caption) parts.push((await insertCaption(composer.editor, res.caption)) ? 'caption' : 'caption (lỗi chèn)');
    if (res.files?.length) {
      const input = composer.input?.isConnected ? composer.input : mediaInput(dialog);
      if (input) {
        attachImages(input, res.files);
        parts.push(`ảnh ${res.image}`);
      } else parts.push('ảnh (không thấy ô chọn ảnh)');
    }
    const warn = res.warnings?.length ? ` · ${res.warnings.join(', ')}` : '';
    toast(`FB Auto Ảnh: đã điền ${parts.join(' + ')}${warn}. Kiểm tra rồi bấm Post.`, Boolean(warn));
  }

  // ===== Nhận lúc ĐĂNG theo element (không dựa vào chữ "Post"/"Đăng") =====
  // Nút Đăng / Tiếp của hộp tạo bài là nút TO nằm dưới ô soạn bài (rộng gần bằng ô soạn bài);
  // các nút emoji, ảnh, gắn thẻ, cảm xúc… chỉ là icon nhỏ. Bấm nút to đó → ghi nhận "đang đăng";
  // sau đó ô soạn bài biến mất (hộp đóng) → tính là ĐÃ ĐĂNG. Không bấm nút đó mà đóng hộp → trả ảnh lại.
  const POST_WINDOW_MS = 3 * 60 * 1000;

  function isPostButton(btn, editor) {
    if (editor.contains(btn) || !(editor.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
    const w = btn.getBoundingClientRect().width;
    const ref = editor.getBoundingClientRect().width;
    return ref > 0 && w >= ref * 0.6;
  }

  function markUsed(s) {
    if (s.done) return;
    s.done = true;
    send({ type: 'USED', token: s.token, item: s.item }).then(r => {
      if (!r?.ok) toast(`FB Auto Ảnh: chưa lưu được ảnh đã đăng — ${r?.error || 'lỗi không rõ'}`, true);
      else if (r.markError) toast(`FB Auto Ảnh: đã lưu cho profile này nhưng chưa ghi được vào da-dang/ — ${r.markError}`, true);
      else toast(`FB Auto Ảnh: đã lưu ảnh${r.image ? ` ${r.image}` : ''} là ĐÃ ĐĂNG ✓`);
    });
  }

  document.addEventListener('click', ev => {
    const btn = ev.target.closest?.('[role="button"],button');
    if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
    const dialog = btn.closest('[role="dialog"]');
    if (!dialog) return;
    for (const [editor, s] of sessions) {
      if (!s.done && (dialog.contains(editor) || dialog === s.dialog) && (!editor.isConnected || isPostButton(btn, editor))) s.postedAt = Date.now();
    }
  }, true);

  function scan() {
    if (!alive()) { observer.disconnect(); return; }
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const composer = findComposer(dialog);
      if (!composer || handled.has(composer.editor) || !isEmpty(composer.editor)) continue;
      handled.add(composer.editor);
      fill(dialog, composer);
    }
    // Ô soạn bài biến mất (đóng hộp / xóa nháp) mà chưa bấm Post → trả ảnh/caption lại để dùng sau
    for (const [editor, s] of sessions) {
      const posting = s.postedAt && Date.now() - s.postedAt < POST_WINDOW_MS;
      // Đã bấm Đăng/Tiếp → chờ tới khi CẢ HỘP đóng/ẩn (Page có màn "Tiếp" → "Đăng" thì vẫn đợi tới lúc đăng xong)
      const dialogOpen = s.dialog?.isConnected && s.dialog.getClientRects().length > 0;
      const gone = posting ? !dialogOpen : !editor.isConnected;
      if (!gone) continue;
      if (posting) markUsed(s);
      else if (!s.done) send({ type: 'RELEASE', token: s.token });
      sessions.delete(editor);
    }
  }

  let timer = null;
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 300); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
