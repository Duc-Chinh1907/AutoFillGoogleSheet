// ==UserScript==
// @name         Đơn Zalo → Google Sheet
// @namespace    rea-don-zalo
// @version      1.1.0
// @description  Đọc tin nhắn đang hiển thị trong nhóm Zalo Web và gửi lên Google Sheet. CHỈ ĐỌC: không gửi tin, không bấm gì trong Zalo.
// @match        https://chat.zalo.me/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @noframes
// @homepageURL  https://github.com/Duc-Chinh1907/AutoFillGoogleSheet
// @updateURL    https://raw.githubusercontent.com/Duc-Chinh1907/AutoFillGoogleSheet/main/userscript/zalo-don-hang.user.js
// @downloadURL  https://raw.githubusercontent.com/Duc-Chinh1907/AutoFillGoogleSheet/main/userscript/zalo-don-hang.user.js
// ==/UserScript==

// Tampermonkey tự cập nhật từ GitHub chỉ khi @version tăng: mỗi lần sửa file này nhớ tăng @version.

/*
 * Cách hoạt động: anh mở nhóm đơn trên chat.zalo.me và cuộn qua các tin cần lấy. Script đọc
 * các tin đang hiện trên màn hình (người gửi, ngày, giờ, nội dung) và gom lại. Bấm "Xem trước"
 * để xem Sheet sẽ ghi gì, bấm "Ghi vào Sheet" để ghi thật.
 *
 * Zalo không công bố cấu trúc trang web, nên các "bộ chọn" bên dưới có thể phải chỉnh khi Zalo
 * đổi giao diện. Dùng nút "Chẩn đoán" để lấy cấu trúc trang (đã che nội dung tin) gửi cho người
 * sửa, rồi dán bộ chọn mới vào Cài đặt → "Nâng cao: bộ chọn tùy chỉnh", không cần sửa code.
 */

const SELECTORS = {
  // Tên cuộc trò chuyện đang mở (đầu khung chat)
  header: ['#header .header-title', '.header-title', '[data-id="txt_Main_Title"]', '.chat-header .title'],
  // Khung chứa danh sách tin
  container: ['#messageViewScroll', '#messageView', '.message-view', '[class*="message-view"]'],
  // Mỗi tin nhắn
  message: ['[id^="bb_msg_id_"]', '.chat-item', '[data-id^="div_ReceivedMsg"], [data-id^="div_SentMsg"]'],
  // Vạch ngăn ngày: "Hôm nay", "Hôm qua", "02/11/2026", "Thứ Hai"...
  dateDivider: ['.chat-date', '.chat-date-time', '[class*="date-divider"]', '[class*="time-divider"]'],
  sender: ['.message-sender-name-content', '[class*="sender-name"]', '.card-sender-name'],
  text: ['[data-component="message-text-content"]', '.text-message', '.card--text .text', '[class*="message-text"]', '.text'],
  time: ['.card-send-time__sendTime', '[class*="send-time"]', '[class*="sendTime"]'],
  // Phần trích dẫn khi "Trả lời" một tin khác: bỏ qua chữ trong này
  quote: ['[class*="quote"]', '[class*="reply"]'],
  // Dấu hiệu tin của chính mình (hiện bên phải)
  mine: ['.me', '[class*="--me"]', '[data-id^="div_SentMsg"]'],
};

// ===================== Hàm thuần (có test trong tests/) =====================

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

const WEEKDAYS = [
  [/chủ nhật|\bcn\b/, 0], [/thứ (hai|2)\b/, 1], [/thứ (ba|3)\b/, 2], [/thứ (tư|4)\b/, 3],
  [/thứ (năm|5)\b/, 4], [/thứ (sáu|6)\b/, 5], [/thứ (bảy|7)\b/, 6],
];

/** Đọc chữ trên vạch ngăn ngày → 'YYYY-MM-DD', hoặc null nếu không hiểu (không đoán). */
function parseDividerDate(text, now) {
  const t = String(text || '').normalize('NFC').toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/hôm nay/.test(t)) return ymd(today);
  if (/hôm qua/.test(t)) return ymd(addDays(today, -1));

  const m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(t);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : today.getFullYear();
    if (y < 100) y += 2000;
    let date = new Date(y, mo - 1, d);
    if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    if (!m[3] && date > today) date = new Date(y - 1, mo - 1, d); // "28/12" xem vào tháng 1 → năm trước
    return ymd(date);
  }

  for (const [re, wd] of WEEKDAYS) {
    if (re.test(t)) return ymd(addDays(today, -(((today.getDay() - wd + 7) % 7) || 7)));
  }
  return null;
}

function parseTime(text) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(text || ''));
  return m ? m[1].padStart(2, '0') + ':' + m[2] : '';
}

const KEEP_TEXT_RE = /^(\d{1,2}:\d{2}\s*)?(hôm nay|hôm qua|(thứ (hai|ba|tư|năm|sáu|bảy|[2-7])|chủ nhật)?,?\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?|thứ (hai|ba|tư|năm|sáu|bảy|[2-7])|chủ nhật)?(\s*\d{1,2}:\d{2})?$/iu;

/** Che nội dung khi chẩn đoán: chỉ giữ giờ và chữ trên vạch ngày. */
function maskText(t) {
  return t && KEEP_TEXT_RE.test(t) ? t : '[' + t.length + ' ký tự]';
}

/**
 * Ghép danh sách tin vừa đọc (theo thứ tự trên màn hình) vào danh sách đã gom, giữ đúng thứ tự
 * khi anh cuộn lên/xuống nhiều lần. Trả về số tin mới.
 */
function mergeSnapshot(order, store, list) {
  let added = 0;
  list.forEach((m, i) => {
    const old = store.get(m.uid);
    if (old) {
      if (!old.date && m.date) old.date = m.date;
      if (!old.time && m.time) old.time = m.time;
      return;
    }
    store.set(m.uid, m);
    added++;
    let pos = -1;
    for (let j = i - 1; j >= 0 && pos < 0; j--) {
      const p = order.indexOf(list[j].uid);
      if (p >= 0) pos = p + 1;
    }
    for (let j = i + 1; j < list.length && pos < 0; j++) {
      const p = order.indexOf(list[j].uid);
      if (p >= 0) pos = p;
    }
    order.splice(pos < 0 ? order.length : pos, 0, m.uid);
  });
  return added;
}

// ===================== Chạy trên trang Zalo =====================

function main() {
  const ME = '__ME__';
  const store = new Map();
  const order = [];
  const sent = new Set(GM_getValue('sentUids', []));
  let autoTimer = null;
  let collecting = false; // chỉ gom khi anh bấm "Bắt đầu gom"; mỗi lần tải lại trang đều tắt

  // ---------- Cài đặt (lưu trong Tampermonkey, không nằm trong code) ----------

  function settings() {
    return {
      url: GM_getValue('url', ''),
      token: GM_getValue('token', ''),
      group: GM_getValue('group', ''),
      autoMinutes: Number(GM_getValue('autoMinutes', 0)) || 0,
    };
  }

  function sel() {
    let custom = {};
    try { custom = JSON.parse(GM_getValue('customSelectors', '') || '{}'); } catch (e) { /* JSON sai thì dùng mặc định */ }
    const out = {};
    Object.keys(SELECTORS).forEach(k => {
      out[k] = Array.isArray(custom[k]) ? custom[k].concat(SELECTORS[k]) : SELECTORS[k];
    });
    return out;
  }

  // Khung cài đặt nằm trong panel: mỗi ô lưu ngay khi sửa xong, nên rời tab đi copy rồi quay lại vẫn còn.
  const FIELDS = [
    { key: 'url', label: '1. URL Web App (kết thúc bằng /exec)', placeholder: 'https://script.google.com/macros/s/…/exec',
      save: v => {
        // Sheet khác (vd. từ bản sao sang Sheet thật): quên danh sách đã gửi, Sheet mới tự chống trùng.
        if (v !== settings().url) { sent.clear(); GM_setValue('sentUids', []); }
        GM_setValue('url', v);
      } },
    { key: 'token', label: '2. Mã bí mật (Sheet → Đơn Zalo → Xem mã bí mật)' },
    { key: 'group', label: '3. Tên nhóm Zalo đơn hàng', pickGroup: true },
    { key: 'autoMinutes', label: '4. Tự động GHI mỗi … phút (0 = tắt)', type: 'number', def: 0,
      save: v => { GM_setValue('autoMinutes', Math.max(0, Number(v) || 0)); restartAuto(); } },
    { key: 'customSelectors', label: 'Nâng cao: bộ chọn tùy chỉnh (JSON, để trống nếu không cần)', multiline: true,
      save: v => {
        if (v) JSON.parse(v); // JSON sai thì báo lỗi, không lưu
        GM_setValue('customSelectors', v);
      } },
  ];
  const inputStyle = 'display:block;box-sizing:border-box;width:300px;margin:2px 0 6px;padding:3px 5px;border:1px solid #999;' +
    'border-radius:4px;font:12px system-ui,sans-serif;color:#111;background:#fff';
  const inputs = {};

  /** Không để phím gõ trong ô cài đặt lọt ra trang Zalo (tránh phím tắt của Zalo, ô soạn tin). */
  function isolate(el) {
    ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut', 'input'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
    return el;
  }

  function settingsForm() {
    const box = h('div', { style: 'margin-top:6px;padding-top:6px;border-top:1px solid #ccd' });
    FIELDS.forEach(f => {
      const input = isolate(h(f.multiline ? 'textarea' : 'input', {
        placeholder: f.placeholder || '', style: inputStyle + (f.multiline ? ';height:56px' : ''),
      }));
      if (!f.multiline) input.type = f.type || 'text';
      input.addEventListener('change', () => {
        const v = input.value.trim();
        try {
          if (f.save) f.save(v); else GM_setValue(f.key, v);
          refreshStatus('✓ Đã lưu: ' + f.label.replace(/^\d\.\s*/, ''));
        } catch (e) {
          refreshStatus('Chưa lưu "' + f.label + '": ' + e.message);
        }
      });
      inputs[f.key] = input;
      box.append(h('label', { style: 'display:block' }, f.label, input));
      if (f.pickGroup) {
        box.append(h('button', { style: btnStyle, onclick: () => {
          const t = headerTitle();
          if (!t) { refreshStatus('Không đọc được tên nhóm đang mở. Bấm Chẩn đoán.'); return; }
          input.value = t;
          input.dispatchEvent(new Event('change'));
        } }, 'Lấy tên nhóm đang mở'));
      }
    });
    box.append(h('button', { style: btnStyle, onclick: () => toggleSettings(false) }, 'Đóng cài đặt'));
    box.hidden = true;
    return box;
  }

  function loadSettingsInputs() {
    FIELDS.forEach(f => { inputs[f.key].value = String(GM_getValue(f.key, f.def !== undefined ? f.def : '')); });
  }

  function toggleSettings(show) {
    body.hidden = false;
    settingsBox.hidden = show === undefined ? !settingsBox.hidden : !show;
    if (!settingsBox.hidden) loadSettingsInputs(); // lấy giá trị mới nhất (có thể đã sửa ở tab khác)
  }

  function openSettings() {
    toggleSettings(true);
  }

  // ---------- Đọc trang ----------

  function first(root, list) {
    for (const s of list) {
      try {
        const el = root.querySelector(s);
        if (el) return { sel: s, el };
      } catch (e) { /* bộ chọn sai cú pháp: bỏ qua */ }
    }
    return null;
  }

  function matchesAny(el, list) {
    return list.some(s => { try { return el.matches(s); } catch (e) { return false; } });
  }

  function clean(t) {
    return String(t || '').normalize('NFC').replace(/ /g, ' ').trim();
  }

  function headerTitle() {
    const hit = first(document, sel().header);
    return hit ? clean(hit.el.innerText) : '';
  }

  function isTargetGroupOpen() {
    const g = settings().group;
    return !!g && clean(headerTitle()).toLowerCase() === clean(g).toLowerCase();
  }

  function ownText(node, S) {
    for (const s of S.text) {
      let els;
      try { els = node.querySelectorAll(s); } catch (e) { continue; }
      for (const el of els) {
        const inQuote = S.quote.some(q => {
          try { const qEl = el.closest(q); return !!qEl && qEl !== node && node.contains(qEl); } catch (e) { return false; }
        });
        if (inQuote) continue;
        const t = clean(el.innerText);
        if (t) return t;
      }
    }
    return '';
  }

  /** Đọc các tin đang có trên màn hình, theo thứ tự từ trên xuống. */
  function readVisible() {
    const S = sel();
    const box = first(document, S.container);
    const root = box ? box.el : document;
    const msgHit = S.message.find(s => { try { return root.querySelector(s); } catch (e) { return false; } });
    if (!msgHit) return { list: [], error: 'Không tìm thấy tin nhắn nào (bộ chọn "message" không khớp). Bấm Chẩn đoán.' };

    const dateSel = S.dateDivider.join(', ');
    const now = new Date();
    const list = [];
    let curDate = null;
    let lastSender = '';

    const setDateFrom = el => {
      const txt = clean(el.innerText);
      if (txt) curDate = parseDividerDate(txt, now); // không hiểu được thì để null, không đoán
      lastSender = '';
    };

    root.querySelectorAll(msgHit + ', ' + dateSel).forEach(node => {
      const isMsg = matchesAny(node, [msgHit]);
      if (!isMsg) {
        if (!node.closest(msgHit)) setDateFrom(node);
        return;
      }
      const inner = node.querySelector(dateSel);
      if (inner) setDateFrom(inner);

      const mine = matchesAny(node, S.mine) || !!first(node, S.mine);
      const text = ownText(node, S);
      const senderHit = first(node, S.sender);
      let sender = '';
      if (mine) {
        sender = ME;
        lastSender = '';
      } else {
        sender = senderHit ? clean(senderHit.el.innerText) : lastSender;
        lastSender = sender;
      }
      if (!text) return; // ảnh, sticker, tin hệ thống

      const timeHit = first(node, S.time);
      const time = timeHit ? parseTime(timeHit.el.innerText) : '';
      const rawId = node.id || node.getAttribute('data-id') || '';
      const msgId = /\d{6,}/.test(rawId) ? rawId : '';
      list.push({
        uid: msgId || [sender, time, text].join('|'),
        msgId, sender: mine ? '' : sender, mine, date: curDate, time, text,
      });
    });
    return { list, error: '' };
  }

  function snapshot() {
    if (!isTargetGroupOpen()) return { added: 0, error: 'Chưa mở đúng nhóm "' + (settings().group || '?') + '".' };
    const { list, error } = readVisible();
    if (error) return { added: 0, error };
    return { added: mergeSnapshot(order, store, list), error: '' };
  }

  function pending() {
    return order.filter(uid => !sent.has(uid)).map(uid => store.get(uid));
  }

  // ---------- Gửi lên Apps Script ----------

  /** skipUids: các tin anh bỏ chọn ở bảng Xem trước (gửi kèm để Sheet đánh dấu "bỏ qua", không ghi). */
  function send(dryRun, skipUids) {
    const s = settings();
    if (!s.url || !s.token || !s.group) {
      openSettings();
      refreshStatus('Điền đủ URL Web App, mã bí mật và tên nhóm trước.');
      return;
    }
    if (collecting) {
      const snap = snapshot();
      if (snap.error) { refreshStatus(snap.error); return; }
    }
    const msgs = pending();
    if (!msgs.length) {
      refreshStatus(collecting || order.length
        ? 'Không có tin mới để gửi.'
        : 'Chưa gom tin nào. Bấm "▶ Bắt đầu gom" rồi cuộn qua các đơn.');
      return;
    }

    refreshStatus(dryRun ? 'Đang xem trước ' + msgs.length + ' tin…' : 'Đang ghi ' + msgs.length + ' tin…');
    GM_xmlhttpRequest({
      method: 'POST',
      url: s.url,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({
        token: s.token, group: s.group, dryRun,
        messages: msgs.map((m, i) => ({
          msgId: m.msgId, sender: m.sender, mine: m.mine, date: m.date, time: m.time, text: m.text,
          cid: i, skip: !!(skipUids && skipUids.has(m.uid)),
        })),
      }),
      timeout: 90000,
      onload: res => {
        let data;
        try { data = JSON.parse(res.responseText); } catch (e) {
          refreshStatus('Web App trả về không phải JSON (HTTP ' + res.status + '). Kiểm tra URL và quyền truy cập "Bất kỳ ai".');
          return;
        }
        if (!data.ok) { refreshStatus('Lỗi: ' + data.error); return; }
        if (!dryRun) {
          msgs.forEach(m => sent.add(m.uid));
          GM_setValue('sentUids', Array.from(sent).slice(-3000));
        }
        refreshStatus(summaryText(data));
        if (dryRun || data.review) showResult(data, msgs);
      },
      onerror: () => refreshStatus('Không kết nối được Web App. Kiểm tra mạng / URL.'),
      ontimeout: () => refreshStatus('Web App phản hồi quá lâu, thử lại.'),
    });
  }

  function summaryText(d) {
    return (d.dryRun ? '[XEM TRƯỚC – chưa ghi] ' : '') +
      d.received + ' tin: ' + d.duplicates + ' tin đã xử lý ở lần trước (bỏ qua), ' + d.written + ' đơn ' + (d.dryRun ? 'sẽ ghi' : 'đã ghi') +
      (d.rows && d.rows.length ? ' (dòng ' + d.rows[0] + '–' + d.rows[d.rows.length - 1] + ')' : '') +
      ', ' + d.review + ' cần kiểm tra, ' + d.skipped + ' bỏ qua' +
      (d.userSkipped ? ' (trong đó ' + d.userSkipped + ' anh bỏ chọn)' : '') + '.';
  }

  function restartAuto() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    const min = settings().autoMinutes;
    if (min > 0) autoTimer = setInterval(() => { if (isTargetGroupOpen()) send(false); }, min * 60000);
  }

  // ---------- Giao diện (chỉ dùng textContent, không chèn HTML từ tin nhắn) ----------

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    Object.assign(el, props || {});
    if (props && props.style) el.style.cssText = props.style;
    kids.flat().forEach(k => el.append(k instanceof Node ? k : document.createTextNode(String(k))));
    return el;
  }

  const btnStyle = 'margin:2px;padding:4px 8px;border:1px solid #888;border-radius:4px;background:#fff;color:#111;cursor:pointer;font-size:12px';
  const statusEl = h('div', { style: 'margin-top:6px;white-space:pre-wrap;max-width:300px' });
  const settingsBox = settingsForm();
  const collectBtn = h('button', { style: btnStyle, onclick: () => setCollecting(!collecting) });
  /** Mỗi lần bấm "Bắt đầu gom" là một lượt mới, đếm lại từ 0 (tin đã ghi vẫn được nhớ để không ghi lại). */
  function startBatch() {
    const waiting = pending().length;
    if (waiting && !confirm('Còn ' + waiting + ' tin đã gom nhưng CHƯA ghi vào Sheet.\n\n' +
      'OK = bỏ các tin đó, gom lại từ đầu.\nHủy = giữ lại, gom tiếp.')) return;
    store.clear();
    order.length = 0;
  }

  function setCollecting(on) {
    if (on) startBatch();
    collecting = on;
    collectBtn.textContent = on ? '⏸ Dừng gom' : '▶ Bắt đầu gom';
    collectBtn.style.cssText = btnStyle + (on ? ';background:#16a34a;color:#fff;border-color:#16a34a' : '');
    if (!on) { refreshStatus('Đã dừng gom.'); return; }
    const r = snapshot();
    // Zalo giữ sẵn trong trang mọi tin đã tải (cả phần chưa cuộn tới), nên lần đọc đầu có thể lấy được rất nhiều tin.
    refreshStatus(r.error || 'Đang gom: lấy ' + r.added + ' tin Zalo đã tải sẵn trong khung chat (kể cả tin chưa cuộn tới). ' +
      'Bấm "Xem trước" để kiểm tra.');
  }
  const body = h('div', {},
    collectBtn,
    h('button', { style: btnStyle, onclick: () => send(true) }, 'Xem trước'),
    h('button', { style: btnStyle + ';background:#0068ff;color:#fff;border-color:#0068ff', onclick: () => send(false) }, 'Ghi vào Sheet'),
    h('br'),
    h('button', { style: btnStyle, onclick: () => toggleSettings() }, 'Cài đặt'),
    h('button', { style: btnStyle, onclick: diagnose }, 'Chẩn đoán'),
    h('button', { style: btnStyle, onclick: () => {
      // Quên cả danh sách đã gửi: Sheet vẫn tự chống trùng, nên gửi lại chỉ tốn thêm chút dữ liệu.
      store.clear();
      order.length = 0;
      sent.clear();
      GM_setValue('sentUids', []);
      refreshStatus('Đã xóa bộ nhớ tạm.');
    } }, 'Xóa bộ nhớ tạm'),
    settingsBox,
    statusEl);
  const title = h('div', { style: 'font-weight:bold;cursor:pointer', onclick: () => { body.hidden = !body.hidden; } }, '📋 Đơn Zalo → Sheet');
  const panel = h('div', {
    style: 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#f7f9fc;color:#111;border:1px solid #9ab;' +
      'border-radius:8px;padding:8px;font:12px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);max-height:90vh;overflow:auto',
  }, title, body);
  panel.dataset.donZalo = '1';
  document.body.append(panel);

  let lastMsg = '';
  /** Cập nhật dòng trạng thái; gọi không tham số thì giữ nguyên thông báo cũ. */
  function refreshStatus(msg) {
    if (msg !== undefined) lastMsg = msg;
    msg = lastMsg;
    const s = settings();
    const open = isTargetGroupOpen();
    const waiting = pending().length;
    statusEl.textContent =
      'Nhóm: ' + (s.group || '(chưa cài)') + (open ? ' ✓ đang mở' : ' – chưa mở') + '\n' +
      (collecting ? '● ĐANG GOM' : '○ Chưa gom') + ' – đã gom: ' + order.length + ' tin, chờ gửi: ' + waiting +
      (s.autoMinutes ? '\nTự động ghi mỗi ' + s.autoMinutes + ' phút' : '') +
      (msg ? '\n→ ' + msg : '');
  }

  /**
   * Bảng kết quả. Khi xem trước: mỗi dòng sẽ ghi / cần kiểm tra có ô tick (mặc định chọn); anh bỏ tick
   * những đơn không muốn ghi rồi bấm "Ghi các đơn đã chọn". Tin bỏ chọn được Sheet đánh dấu bỏ qua.
   */
  function showResult(d, msgs) {
    const cell = 'border:1px solid #ccc;padding:3px 5px;vertical-align:top';
    const label = { order: 'Ghi', review: 'Cần kiểm tra', skip: 'Bỏ qua' };
    const color = { order: '#d9f7d9', review: '#ffe9b3', skip: '#eee' };
    const details = d.details || [];
    const pickable = d.dryRun && Array.isArray(msgs);
    const boxes = []; // [{ r, box }] cho các dòng có ô tick

    const writeBtn = h('button', { style: btnStyle + ';background:#0068ff;color:#fff;border-color:#0068ff' });
    const updateWriteBtn = () => {
      const off = boxes.filter(b => !b.box.checked).length;
      writeBtn.textContent = 'Ghi các đơn đã chọn vào Sheet (' + (boxes.length - off) + ' chọn' + (off ? ', bỏ ' + off : '') + ')';
    };

    const rows = details.map(r => {
      let tick = '';
      if (pickable && r.result !== 'skip') {
        const box = h('input', { type: 'checkbox', checked: true, onchange: updateWriteBtn });
        boxes.push({ r, box });
        tick = box;
      }
      return h('tr', { style: 'background:' + color[r.result] },
        ...(pickable ? [h('td', { style: cell + ';text-align:center' }, tick)] : []),
        h('td', { style: cell }, label[r.result] || r.result),
        h('td', { style: cell }, r.date || '?', r.time ? ' ' + r.time : ''),
        h('td', { style: cell }, r.sender || '?'),
        h('td', { style: cell }, r.ctv || ''),
        h('td', { style: cell + ';white-space:pre-wrap;max-width:360px' }, r.text),
        h('td', { style: cell }, r.reason || ''));
    });

    const tools = [];
    if (pickable && boxes.length) {
      // "Chỉ ghi từ ngày …": bỏ tick mọi đơn trước ngày đó (vd. đơn hôm trước đã ghi tay rồi).
      const dates = Array.from(new Set(boxes.map(b => b.r.date).filter(Boolean))).sort();
      const fromDate = h('select', { style: 'margin:0 6px;font-size:12px', onchange: () => {
        boxes.forEach(b => { b.box.checked = !fromDate.value || (b.r.date || '') >= fromDate.value; });
        updateWriteBtn();
      } }, h('option', { value: '' }, 'tất cả các ngày'),
        dates.map(dt => h('option', { value: dt }, dt.split('-').reverse().join('/'))));
      const setAll = on => () => { boxes.forEach(b => { b.box.checked = on; }); updateWriteBtn(); };
      writeBtn.onclick = () => {
        const skip = new Set();
        boxes.filter(b => !b.box.checked).forEach(b => (b.r.cids || []).forEach(i => { if (msgs[i]) skip.add(msgs[i].uid); }));
        if (skip.size && !confirm('Các đơn bỏ chọn sẽ KHÔNG được ghi và lần sau cũng không hiện lại. Tiếp tục?')) return;
        overlay.remove();
        send(false, skip);
      };
      updateWriteBtn();
      tools.push(h('div', { style: 'margin:6px 0' },
        'Chỉ ghi từ ngày', fromDate,
        h('button', { style: btnStyle, onclick: setAll(true) }, 'Chọn hết'),
        h('button', { style: btnStyle, onclick: setAll(false) }, 'Bỏ chọn hết'),
        writeBtn));
    }

    const heads = (pickable ? ['Chọn'] : []).concat(['Kết quả', 'Ngày', 'Tên Zalo', 'Tên CTV', 'Đơn Hàng', 'Lý do']);
    const overlay = h('div', {
      style: 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center',
      onclick: e => { if (e.target === overlay) overlay.remove(); },
    }, h('div', { style: 'background:#fff;color:#111;max-width:95vw;max-height:90vh;overflow:auto;padding:12px;border-radius:8px;font:12px/1.4 system-ui,sans-serif' },
      h('div', { style: 'font-weight:bold;margin-bottom:6px' }, summaryText(d), ' Tab: ', d.mainSheet || ''),
      h('button', { style: btnStyle, onclick: () => overlay.remove() }, 'Đóng'),
      tools,
      h('table', { style: 'border-collapse:collapse;margin-top:6px' },
        h('tr', {}, heads.map(t => h('th', { style: cell + ';background:#f0f0f0' }, t))),
        rows)));
    overlay.dataset.donZalo = '1';
    document.body.append(overlay);
  }

  // ---------- Chẩn đoán: lấy cấu trúc trang, đã che nội dung ----------

  function outline(el, depth, maxDepth, out) {
    if (out.length > 500) return out;
    const pad = '  '.repeat(depth);
    if (el.nodeType === 3) {
      const t = clean(el.textContent);
      if (t) out.push(pad + '"' + maskText(t) + '"');
      return out;
    }
    if (el.nodeType !== 1) return out;
    let tag = el.tagName.toLowerCase();
    if (el.id) tag += '#' + el.id;
    if (el.classList.length) tag += '.' + Array.from(el.classList).join('.');
    ['data-id', 'data-component', 'role'].forEach(a => { if (el.hasAttribute(a)) tag += '[' + a + '="' + el.getAttribute(a) + '"]'; });
    out.push(pad + '<' + tag + '>');
    if (depth < maxDepth) el.childNodes.forEach(c => outline(c, depth + 1, maxDepth, out));
    return out;
  }

  function ancestry(el) {
    const chain = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      chain.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList.length ? '.' + Array.from(e.classList).join('.') : '') +
        (e.getAttribute('data-id') ? '[data-id="' + e.getAttribute('data-id') + '"]' : ''));
    }
    return chain.join('\n  ↑ ');
  }

  /** Chờ anh bấm 1 lần vào phần tử trên trang; chặn cú bấm đó để Zalo không phản ứng gì. */
  function pickElement(hint, done) {
    refreshStatus(hint);
    const types = ['pointerdown', 'mousedown', 'mouseup', 'click'];
    const block = e => {
      if (panel.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.type !== 'click') return;
      types.forEach(t => window.removeEventListener(t, block, true));
      done(e.target);
    };
    types.forEach(t => window.addEventListener(t, block, true));
  }

  function diagnose() {
    const S = sel();
    const box = first(document, S.container);
    const root = box ? box.el : document;
    const report = ['=== Chẩn đoán Đơn Zalo ' + new Date().toISOString() + ' ===',
      'header: ' + (first(document, S.header) ? first(document, S.header).sel + ' → "' + headerTitle() + '"' : 'KHÔNG KHỚP'),
      'container: ' + (box ? box.sel : 'KHÔNG KHỚP')];
    ['message', 'dateDivider', 'sender', 'text', 'time', 'mine'].forEach(k => {
      const counts = S[k].map(s => { try { return s + ' = ' + root.querySelectorAll(s).length; } catch (e) { return s + ' = lỗi'; } });
      report.push(k + ': ' + counts.join(' | '));
    });
    const { list, error } = readVisible();
    report.push('Đọc được ' + list.length + ' tin' + (error ? ' – ' + error : ''));
    list.slice(-8).forEach(m => report.push('  • ' + (m.mine ? '(mình)' : (m.sender ? m.sender[0] + '… (' + m.sender.length + ')' : '?')) +
      ' | ngày ' + (m.date || '?') + ' | giờ ' + (m.time || '?') + ' | id ' + (m.msgId ? 'có' : 'không') + ' | ' + m.text.length + ' ký tự'));

    pickElement('Chẩn đoán bước 1/2: bấm vào NỘI DUNG một tin nhắn đơn trong khung chat.', msgEl => {
      let wrap = msgEl;
      for (let i = 0; i < 7 && wrap.parentElement && wrap.parentElement !== root; i++) wrap = wrap.parentElement;
      report.push('', '--- Tin đã bấm (tổ tiên) ---', '  ' + ancestry(msgEl), '', '--- Cấu trúc quanh tin (đã che chữ) ---');
      report.push(...outline(wrap, 0, 14, []));

      pickElement('Chẩn đoán bước 2/2: bấm vào TÊN NHÓM ở đầu khung chat.', headEl => {
        report.push('', '--- Tên nhóm đã bấm ---', '  ' + ancestry(headEl));
        GM_setClipboard(report.join('\n'), 'text');
        refreshStatus('Đã chép kết quả chẩn đoán vào bộ nhớ tạm. Dán (Cmd+V) gửi cho người hỗ trợ. Nội dung tin đã được che.');
      });
    });
  }

  // ---------- Khởi động ----------

  GM_registerMenuCommand('Cài đặt', openSettings);

  // Khi đang gom: đọc màn hình tối đa mỗi giây một lần khi trang thay đổi (kể cả đang cuộn liên tục,
  // để không sót tin lướt qua), và đọc thêm một lần khi trang đứng yên.
  let debounce = null;
  let lastSnap = 0;
  const collect = () => {
    lastSnap = Date.now();
    if (collecting && isTargetGroupOpen()) snapshot();
    refreshStatus();
  };
  const ours = n => n.nodeType === 1 && !!n.closest('[data-don-zalo]');
  new MutationObserver(muts => {
    if (muts.every(m => ours(m.target) || Array.from(m.addedNodes).concat(Array.from(m.removedNodes)).some(ours))) return;
    clearTimeout(debounce);
    if (Date.now() - lastSnap > 1000) collect();
    debounce = setTimeout(collect, 800);
  }).observe(document.body, { childList: true, subtree: true });

  restartAuto();
  setCollecting(false);
  refreshStatus(settings().url ? 'Bấm "▶ Bắt đầu gom" rồi cuộn qua các đơn cần lấy.' : 'Bấm "Cài đặt" để nhập URL Web App, mã bí mật và tên nhóm.');
}

if (typeof window !== 'undefined' && window.location && /chat\.zalo\.me$/.test(window.location.hostname)) main();
