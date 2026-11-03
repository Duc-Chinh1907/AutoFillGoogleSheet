/**
 * Đơn Zalo → Google Sheet
 *
 * Nhận tin nhắn nhóm Zalo do userscript (chạy trên chat.zalo.me) gửi lên,
 * tách ra đơn hàng và ghi vào tab đơn hàng. Chỉ ghi 3 cột: Ngày, Đơn Hàng, Tên CTV.
 * Các cột còn lại (Mã Đơn, Tổng tiền, Chiết khấu...) do công thức của Sheet tự tính.
 *
 * Tab phụ (tự tạo khi chạy "Cài đặt lần đầu"):
 *   - Cần kiểm tra : đơn không chắc chắn, chờ duyệt tay
 *   - CTV_Map      : tên Zalo → Tên CTV ghi vào Sheet
 *   - Nhật ký      : mỗi lần chạy ghi 1 dòng thống kê
 *   - _DaXuLy      : (ẩn) các tin đã xử lý, dùng để chống trùng
 */

const CONFIG = {
  HEADERS: { date: 'Ngày', order: 'Đơn Hàng', ctv: 'Tên CTV' },
  REVIEW_SHEET: 'Cần kiểm tra',
  CTV_MAP_SHEET: 'CTV_Map',
  LOG_SHEET: 'Nhật ký',
  PROCESSED_SHEET: '_DaXuLy',
  HEADER_SEARCH_ROWS: 5,     // tìm dòng tiêu đề trong 5 dòng đầu
  MERGE_WINDOW_MINUTES: 5,   // gộp tin bổ sung (SĐT, link...) của cùng CTV gửi ngay sau đơn
  MAX_TEXT_LENGTH: 5000,
  KEEP_PROCESSED_DAYS: 60,   // tab _DaXuLy chỉ nhớ tin đã xử lý trong 60 ngày gần nhất, cũ hơn thì tự xóa
};

const PROP = {
  TOKEN: 'API_TOKEN',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  MAIN_SHEET: 'MAIN_SHEET_NAME',
};

const REVIEW_HEADERS = ['Nhận lúc', 'Ngày', 'Giờ', 'Tên Zalo', 'Tên CTV', 'Đơn Hàng', 'Lý do', 'Duyệt', 'Trạng thái'];

// ===================== Web App =====================

function doGet() {
  return json_({ ok: true, message: 'Web App đơn Zalo đang chạy.' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return json_({ ok: false, error: 'Dữ liệu gửi lên không phải JSON.' });
  }

  const token = PropertiesService.getScriptProperties().getProperty(PROP.TOKEN);
  if (!token || body.token !== token) {
    return json_({ ok: false, error: 'Sai mã bí mật (token). Kiểm tra lại phần Cài đặt của userscript.' });
  }
  if (!Array.isArray(body.messages)) {
    return json_({ ok: false, error: 'Thiếu danh sách tin nhắn.' });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json_({ ok: false, error: 'Đang có lần chạy khác, thử lại sau ít giây.' });
  }
  try {
    const result = processMessages_(body.messages, { dryRun: !!body.dryRun, group: String(body.group || '') });
    console.log(JSON.stringify(Object.assign({}, result, { details: undefined })));
    return json_(result);
  } catch (err) {
    console.error(err);
    try {
      appendLog_(ensureAuxSheets_(getSpreadsheet_()).log, { mode: body.dryRun ? 'Xem trước' : 'Ghi', error: String(err) });
    } catch (ignored) { /* không ghi được log thì thôi, vẫn trả lỗi về */ }
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===================== Xử lý chính =====================

function processMessages_(raw, opts) {
  const ss = getSpreadsheet_();
  const aux = ensureAuxSheets_(ss);
  const main = getMainSheet_(ss); // kiểm tra cấu hình ngay cả khi chỉ xem trước

  const messages = raw.map(sanitizeMessage_).filter(Boolean);
  messages.forEach(m => { m.key = messageKey_(m, opts.group); });

  const processed = loadProcessedKeys_(aux.processed);
  const seen = new Set();
  const fresh = [];
  let duplicates = 0;
  messages.forEach(m => {
    if (processed.has(m.key) || seen.has(m.key)) {
      duplicates++;
    } else {
      seen.add(m.key);
      fresh.push(m);
    }
  });

  const ctv = loadCtvMap_(aux.ctvMap);
  const results = classifyMessages_(fresh, ctv.map, CONFIG, getCtvChoices_(main, findHeaders_(main)));

  // Tin anh bỏ chọn ở bảng Xem trước: không ghi, nhưng vẫn đánh dấu đã xử lý để lần sau không hiện lại.
  const userSkippedKeys = new Set(fresh.filter(m => m.userSkip).map(m => m.key));
  let userSkipped = 0;
  results.forEach(r => {
    if (r.result !== 'skip' && r.keys.some(k => userSkippedKeys.has(k))) {
      r.result = 'skip';
      r.reason = 'Anh bỏ chọn khi xem trước';
      userSkipped++;
    }
  });
  const orders = results.filter(r => r.result === 'order');
  const reviews = results.filter(r => r.result === 'review');
  const skipped = results.filter(r => r.result === 'skip');

  // Thêm sẵn tên Zalo chưa có vào CTV_Map (cột Tên CTV để trống) để anh điền, kể cả khi xem trước.
  addMissingCtvNames_(aux.ctvMap, results, ctv.allNames);

  let rows = [];
  if (!opts.dryRun) {
    if (orders.length) rows = sortOrdersByDate_(main, appendOrders_(main, orders));
    if (reviews.length) appendReviews_(aux.review, reviews);
    markProcessed_(aux.processed, results);
    pruneProcessed_(aux.processed);
  }

  const summary = {
    ok: true,
    dryRun: opts.dryRun,
    mainSheet: main.getName(),
    received: raw.length,
    invalid: raw.length - messages.length,
    duplicates: duplicates,
    newMessages: fresh.length,
    written: orders.length,
    review: reviews.length,
    skipped: skipped.length,
    userSkipped: userSkipped,
    rows: rows,
  };
  if (!opts.dryRun) appendLog_(aux.log, Object.assign({ mode: 'Ghi' }, summary));

  // cids: vị trí các tin (trong danh sách userscript gửi lên) thuộc từng dòng, để userscript biết bỏ chọn tin nào.
  const cidByKey = new Map(fresh.map(m => [m.key, m.cid]));
  summary.details = results.map(r => ({
    result: r.result, reason: r.reason, date: r.date, time: r.time,
    sender: r.sender, ctv: r.ctv, text: r.text, parts: r.keys.length,
    cids: r.keys.map(k => cidByKey.get(k)),
  }));
  return summary;
}

function sanitizeMessage_(m) {
  if (!m || typeof m !== 'object') return null;
  const text = String(m.text || '').normalize('NFC').replace(/\r\n?/g, '\n').trim().slice(0, CONFIG.MAX_TEXT_LENGTH);
  if (!text) return null;
  return {
    msgId: String(m.msgId || '').slice(0, 100),
    sender: String(m.sender || '').normalize('NFC').trim().slice(0, 200),
    date: /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : '',
    time: /^\d{1,2}:\d{2}$/.test(m.time) ? m.time : '',
    mine: !!m.mine,
    text: text,
    cid: Number.isInteger(m.cid) ? m.cid : -1,
    userSkip: !!m.skip,
  };
}

function messageKey_(m, group) {
  if (m.msgId) return 'id:' + m.msgId;
  const raw = [group, m.sender, m.date, m.time, m.text].join('\u241F');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return 'h:' + digest.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// ===================== Tách đơn (hàm thuần, không đụng Sheet) =====================

const PRICE_PATTERN = '\\d+(?:[.,]\\d{3})*\\s*(?:k|đ|vnđ|vnd)(?![a-z])';
const RE = {
  // Dòng món theo đúng quy tắc công thức cột "Tổng tiền hàng": sau khi TRIM, bắt đầu bằng số
  // và kết thúc bằng "<số>k" (k thường). Vd. "1 mì trộn bò mĩ 45k", "1 combo 260k".
  item: /^\d+.*\d+\s*k\s*$/,
  // Trông như dòng món nhưng công thức Sheet không tính được tiền: "1 cơm 40K", "2 trà 30.000đ"
  looseItem: new RegExp('^\\d{1,3}\\s*x?\\s+[^\\d\\s].*?' + PRICE_PATTERN, 'i'),
  price: new RegExp(PRICE_PATTERN, 'i'),
  phone: /(?<!\d)(?:\+?84|0)(?:[\s.\-]?\d){9}(?!\d)/,
  map: /maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps/i,
  ship: /\bship\b/i,
};

function features_(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()); // giống TRIM() của Sheets
  const f = {
    hasItem: lines.some(l => RE.item.test(l)),
    hasLooseItem: lines.some(l => RE.looseItem.test(l)),
    hasPrice: RE.price.test(text),
    hasPhone: RE.phone.test(text),
    hasMap: RE.map.test(text),
    hasShip: RE.ship.test(text),
  };
  f.hasContact = f.hasPhone || f.hasMap || f.hasShip;
  return f;
}

/**
 * Gộp tin và phân loại. Mỗi kết quả có result = 'order' | 'review' | 'skip'.
 * Tin bổ sung (không có dòng món nhưng có SĐT/link/giá) của cùng người gửi, gửi ngay sau
 * một tin có món, được gộp vào đơn đó.
 */
function classifyMessages_(messages, ctvMap, cfg, ctvChoices) {
  const groups = [];
  let open = null;
  messages.forEach(m => {
    if (m.mine) {
      open = null;
      groups.push({ parts: [m], mine: true });
      return;
    }
    const f = features_(m.text);
    if (open && !f.hasItem && (f.hasContact || f.hasPrice) && m.sender && m.sender === open.sender
        && closeInTime_(open.last, m, cfg.MERGE_WINDOW_MINUTES)) {
      open.parts.push(m);
      open.last = m;
      return;
    }
    const g = { parts: [m], sender: m.sender, last: m };
    groups.push(g);
    open = f.hasItem || f.hasLooseItem ? g : null;
  });
  return groups.map(g => judgeGroup_(g, ctvMap, ctvChoices || null));
}

function closeInTime_(a, b, minutes) {
  if (a.date && b.date && a.date !== b.date) return false;
  if (!a.time || !b.time) return true; // Zalo không hiện giờ ở mọi tin; tin liền kề cùng người gửi coi là gần nhau
  const toMin = t => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  return Math.abs(toMin(b.time) - toMin(a.time)) <= minutes;
}

/** ctvChoices: Map(tên đã chuẩn hóa → tên đúng) lấy từ ô chọn của cột Tên CTV, hoặc null nếu cột không có ô chọn. */
function judgeGroup_(g, ctvMap, ctvChoices) {
  const first = g.parts[0];
  const r = {
    keys: g.parts.map(p => p.key),
    date: first.date, time: first.time, sender: first.sender, ctv: '',
    // Bỏ dấu cách thừa cuối mỗi dòng: công thức cột Tổng tiền hàng báo #N/A với dòng "…45k ".
    // Chỉ áp dụng cho chữ ghi vào Sheet, khóa chống trùng vẫn tính trên nội dung gốc.
    text: g.parts.map(p => p.text.replace(/[ \t ]+$/gm, '')).join('\n'),
    result: 'skip', reason: '',
  };
  if (g.mine) {
    r.reason = 'Tin của chính anh';
    return r;
  }

  const f = features_(r.text);
  if (!f.hasItem) {
    if (f.hasLooseItem) {
      r.result = 'review';
      r.reason = 'Có món nhưng Sheet sẽ không tính được tiền: dòng món phải bắt đầu bằng số và kết thúc bằng giá dạng "45k" (k thường)';
    } else if (f.hasPrice || f.hasPhone || f.hasMap) {
      r.result = 'review';
      r.reason = 'Có giá/SĐT/link nhưng không thấy dòng món dạng "1 tên món 45k"';
    } else {
      r.reason = 'Tin trò chuyện, không phải đơn';
    }
    // Điền sẵn Tên CTV (nếu tra được) để anh khỏi gõ khi duyệt tay.
    if (r.result === 'review') r.ctv = resolveCtv_(r.sender, ctvMap, ctvChoices).ctv;
    return r;
  }

  const reasons = [];
  if (!f.hasContact) reasons.push('Không thấy SĐT, link bản đồ hoặc phí ship');
  if (!r.date) reasons.push('Không xác định được ngày');
  if (!r.sender) {
    reasons.push('Không rõ người gửi');
  } else {
    const c = resolveCtv_(r.sender, ctvMap, ctvChoices);
    if (c.problem) reasons.push(c.problem);
    r.ctv = c.ctv;
  }
  r.result = reasons.length ? 'review' : 'order';
  r.reason = reasons.join('; ');
  return r;
}

/** Tên Zalo → Tên CTV (đúng chữ hoa/thường theo ô chọn), hoặc lý do không tra được. */
function resolveCtv_(sender, ctvMap, ctvChoices) {
  if (!sender) return { ctv: '', problem: 'Không rõ người gửi' };
  const mapped = ctvMap.get(norm_(sender)) || '';
  if (!mapped) return { ctv: '', problem: 'Chưa có Tên CTV cho "' + sender + '" trong tab ' + CONFIG.CTV_MAP_SHEET };
  if (ctvChoices && !ctvChoices.has(norm_(mapped))) {
    return { ctv: '', problem: 'Tên CTV "' + mapped + '" (tab ' + CONFIG.CTV_MAP_SHEET + ') không có trong ô chọn của cột Tên CTV' };
  }
  return { ctv: ctvChoices ? ctvChoices.get(norm_(mapped)) : mapped, problem: '' };
}

function norm_(s) {
  return String(s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ===================== Ghi vào Sheet =====================

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Chưa chạy "Cài đặt lần đầu" trong menu Đơn Zalo.');
  return ss;
}

function getMainSheet_(ss) {
  const name = PropertiesService.getScriptProperties().getProperty(PROP.MAIN_SHEET);
  if (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Không thấy tab "' + name + '". Mở tab đơn hàng rồi chọn menu Đơn Zalo → "Đặt tab đang mở làm tab ghi đơn".');
    if (!findHeaders_(sheet)) throw new Error('Tab "' + name + '" thiếu cột ' + Object.values(CONFIG.HEADERS).join(' / ') + '.');
    return sheet;
  }
  const candidates = ss.getSheets().filter(s => findHeaders_(s));
  if (candidates.length === 1) return candidates[0];
  throw new Error(candidates.length
    ? 'Có nhiều tab có cột đơn hàng (' + candidates.map(s => s.getName()).join(', ') + '). Mở đúng tab rồi chọn menu Đơn Zalo → "Đặt tab đang mở làm tab ghi đơn".'
    : 'Không tìm thấy tab nào có các cột ' + Object.values(CONFIG.HEADERS).join(' / ') + '.');
}

/** Trả về { headerRow, date, order, ctv } (số cột tính từ 1) hoặc null. */
function findHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  const rows = Math.min(CONFIG.HEADER_SEARCH_ROWS, sheet.getLastRow());
  if (!lastCol || !rows) return null;
  const values = sheet.getRange(1, 1, rows, lastCol).getDisplayValues();
  const wanted = {};
  Object.keys(CONFIG.HEADERS).forEach(k => { wanted[k] = norm_(CONFIG.HEADERS[k]); });
  for (let r = 0; r < values.length; r++) {
    const cells = values[r].map(norm_);
    const found = { headerRow: r + 1 };
    let ok = true;
    Object.keys(wanted).forEach(k => {
      const idx = cells.indexOf(wanted[k]);
      if (idx < 0) ok = false; else found[k] = idx + 1;
    });
    if (ok) return found;
  }
  return null;
}

/** Ghi các đơn vào sau dòng cuối cùng có dữ liệu ở 3 cột Ngày / Đơn Hàng / Tên CTV. Trả về số dòng đã ghi. */
function appendOrders_(sheet, orders) {
  const h = findHeaders_(sheet);
  if (!h) throw new Error('Tab "' + sheet.getName() + '" thiếu cột ' + Object.values(CONFIG.HEADERS).join(' / ') + '.');

  const sorted = orders.slice().sort((a, b) => String(dateKey_(a.date)).localeCompare(String(dateKey_(b.date))));
  const start = findNextEmptyRow_(sheet, h);
  const n = sorted.length;
  const limit = formulaRowLimit_(sheet);
  if (start + n - 1 > limit) {
    throw new Error('Tab "' + sheet.getName() + '" chỉ có công thức đến dòng ' + limit + ', không đủ chỗ cho ' + n +
      ' đơn mới (bắt đầu từ dòng ' + start + '). Anh kéo dài bảng và các công thức xuống thêm rồi chạy lại. Chưa ghi gì.');
  }
  const needed = start + n - 1 - sheet.getMaxRows();
  if (needed > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needed);

  // Chỉ ghi 3 cột; các cột công thức (kể cả công thức mảng ở dòng 2) không bị đụng tới.
  sheet.getRange(start, h.date, n, 1).setValues(sorted.map(o => [toDate_(o.date)]));
  sheet.getRange(start, h.order, n, 1).setValues(sorted.map(o => [o.text]));
  sheet.getRange(start, h.ctv, n, 1).setValues(sorted.map(o => [o.ctv]));
  return sorted.map((o, i) => start + i);
}

/**
 * Sắp xếp lại 3 cột Ngày / Đơn Hàng / Tên CTV theo ngày (cùng ngày thì giữ thứ tự cũ, dòng không có
 * ngày xuống cuối). Không dùng Range.sort để không đụng các cột công thức: chỉ đọc 3 cột rồi ghi lại.
 * Mã Đơn đánh theo số dòng nên sẽ đổi theo; anh đã xác nhận Mã Đơn không quan trọng.
 * Trả về số dòng mới của các dòng `rows` (đã sắp tăng dần).
 */
function sortOrdersByDate_(sheet, rows) {
  const h = findHeaders_(sheet);
  const first = h.headerRow + 1;
  const n = findNextEmptyRow_(sheet, h) - first;
  if (n < 2) return rows || [];

  const cols = [h.date, h.order, h.ctv];
  const data = cols.map(c => sheet.getRange(first, c, n, 1).getValues());
  const key = i => (data[0][i][0] instanceof Date ? data[0][i][0].getTime() : Infinity);
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => key(a) - key(b) || a - b);
  if (idx.some((v, i) => v !== i)) {
    cols.forEach((c, k) => sheet.getRange(first, c, n, 1).setValues(idx.map(i => data[k][i])));
  }
  const newRow = new Map(idx.map((oldI, newI) => [first + oldI, first + newI]));
  return (rows || []).map(r => newRow.get(r) || r).sort((a, b) => a - b);
}

function findNextEmptyRow_(sheet, h) {
  const lastRow = sheet.getLastRow();
  let last = h.headerRow;
  if (lastRow > h.headerRow) {
    [h.date, h.order, h.ctv].forEach(col => {
      const vals = sheet.getRange(h.headerRow + 1, col, lastRow - h.headerRow, 1).getValues();
      for (let i = vals.length - 1; i >= 0; i--) {
        if (vals[i][0] !== '' && vals[i][0] !== null) {
          last = Math.max(last, h.headerRow + 1 + i);
          break;
        }
      }
    });
  }
  return last + 1;
}

/**
 * Sheet kéo sẵn công thức (và bảng) xuống tới một dòng nhất định; dưới dòng đó không có công thức.
 * Nếu dòng cuối của tab có công thức thì đó là giới hạn, ngược lại không giới hạn.
 */
function formulaRowLimit_(sheet) {
  const last = sheet.getLastRow();
  const hasFormula = sheet.getRange(last, 1, 1, sheet.getLastColumn()).getFormulas()[0].some(Boolean);
  return hasFormula ? last : Infinity;
}

/** Danh sách tên trong ô chọn của cột Tên CTV → Map(tên chuẩn hóa → tên đúng), hoặc null nếu không đọc được. */
function getCtvChoices_(sheet, h) {
  const values = choicesFromValidation_(sheet.getRange(h.headerRow + 1, h.ctv)) || choicesFromSheetsApi_(sheet, h);
  if (!values) return null;
  const choices = new Map();
  values.map(v => String(v).trim()).filter(Boolean).forEach(v => choices.set(norm_(v), v));
  return choices.size ? choices : null;
}

/** Ô chọn kiểu "Xác thực dữ liệu" thông thường. */
function choicesFromValidation_(cell) {
  const rule = cell.getDataValidation();
  if (!rule) return null;
  const type = rule.getCriteriaType();
  const args = rule.getCriteriaValues();
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return args[0];
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) return args[0].getValues().flat();
  return null;
}

/**
 * Cột kiểu "Menu thả xuống" của Bảng (Table) không đọc được bằng SpreadsheetApp.
 * Cần bật dịch vụ nâng cao "Google Sheets API" trong Apps Script (xem README, Bước 2).
 */
function choicesFromSheetsApi_(sheet, h) {
  if (typeof Sheets === 'undefined') return null;
  const listValues = cond => (cond && cond.type === 'ONE_OF_LIST' && cond.values)
    ? cond.values.map(v => v.userEnteredValue).filter(Boolean) : null;
  try {
    const a1 = "'" + sheet.getName().replace(/'/g, "''") + "'!" + sheet.getRange(h.headerRow + 1, h.ctv).getA1Notation();
    const res = Sheets.Spreadsheets.get(sheet.getParent().getId(), {
      ranges: [a1],
      fields: 'sheets(properties(sheetId),tables(range,columnProperties),data(rowData(values(dataValidation))))',
    });
    for (const s of res.sheets || []) {
      const cell = (((s.data || [])[0] || {}).rowData || [])[0];
      const fromCell = listValues(cell && cell.values && cell.values[0] && cell.values[0].dataValidation && cell.values[0].dataValidation.condition);
      if (fromCell) return fromCell;
      for (const t of s.tables || []) {
        const r = t.range || {};
        if ((r.sheetId || 0) !== sheet.getSheetId()) continue;
        const colIdx = h.ctv - 1 - (r.startColumnIndex || 0);
        const col = (t.columnProperties || []).find(c => (c.columnIndex || 0) === colIdx);
        const fromTable = listValues(col && col.dataValidationRule && col.dataValidationRule.condition);
        if (fromTable) return fromTable;
      }
    }
  } catch (err) {
    console.warn('Không đọc được ô chọn qua Sheets API: ' + err);
  }
  return null;
}

/** Cho cột "Tên CTV ghi vào Sheet" của tab CTV_Map dùng cùng ô chọn với tab đơn hàng. */
function applyCtvChoicesToMap_(ss) {
  const main = getMainSheet_(ss);
  const choices = getCtvChoices_(main, findHeaders_(main));
  if (!choices) return 0;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(Array.from(choices.values()), true)
    .setAllowInvalid(true)
    .build();
  const mapSheet = ensureAuxSheets_(ss).ctvMap;
  mapSheet.getRange(2, 2, Math.max(mapSheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  return choices.size;
}

function dateKey_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return d || '';
}

function toDate_(d) {
  if (d instanceof Date) return d;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : '';
}

// ===================== Tab phụ =====================

function ensureAuxSheets_(ss) {
  const get = (name, headers, hide) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
      if (hide) sh.hideSheet();
    }
    return sh;
  };
  return {
    review: get(CONFIG.REVIEW_SHEET, REVIEW_HEADERS),
    ctvMap: get(CONFIG.CTV_MAP_SHEET, ['Tên Zalo (người gửi)', 'Tên CTV ghi vào Sheet']),
    log: get(CONFIG.LOG_SHEET, ['Thời điểm', 'Chế độ', 'Tin nhận', 'Trùng (bỏ)', 'Tin mới', 'Đơn đã ghi', 'Cần kiểm tra', 'Bỏ qua', 'Dòng đã ghi / Lỗi']),
    processed: get(CONFIG.PROCESSED_SHEET, ['Khóa tin', 'Xử lý lúc', 'Kết quả', 'Tên Zalo'], true),
  };
}

function loadProcessedKeys_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return new Set();
  return new Set(sheet.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])));
}

function markProcessed_(sheet, results) {
  const now = new Date();
  const rows = [];
  results.forEach(r => r.keys.forEach(k => rows.push([k, now, r.result, r.sender])));
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
}

/** Xóa các khóa tin xử lý quá CONFIG.KEEP_PROCESSED_DAYS ngày. Dòng luôn ghi nối tiếp nên dòng cũ nằm trên cùng. */
function pruneProcessed_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const cutoff = Date.now() - CONFIG.KEEP_PROCESSED_DAYS * 86400000;
  const times = sheet.getRange(2, 2, last - 1, 1).getValues();
  let n = 0;
  while (n < times.length && times[n][0] instanceof Date && times[n][0].getTime() < cutoff) n++;
  if (!n) return 0;
  // Không được xóa hết mọi dòng dưới tiêu đề (Sheets báo lỗi), nên trường hợp đó chỉ xóa nội dung.
  if (n >= sheet.getMaxRows() - 1) sheet.getRange(2, 1, n, sheet.getLastColumn()).clearContent();
  else sheet.deleteRows(2, n);
  return n;
}

function loadCtvMap_(sheet) {
  const map = new Map();
  const allNames = new Set();
  const last = sheet.getLastRow();
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 2).getDisplayValues().forEach(([zalo, ctv]) => {
      if (!zalo.trim()) return;
      allNames.add(norm_(zalo));
      if (ctv.trim()) map.set(norm_(zalo), ctv.trim());
    });
  }
  return { map, allNames };
}

function addMissingCtvNames_(sheet, results, allNames) {
  const added = new Set();
  const rows = [];
  results.forEach(r => {
    if (r.result === 'skip' || !r.sender || r.ctv) return;
    const k = norm_(r.sender);
    if (allNames.has(k) || added.has(k)) return;
    added.add(k);
    rows.push([r.sender, '']);
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
}

function appendReviews_(sheet, reviews) {
  const now = new Date();
  const rows = reviews.map(r => [now, toDate_(r.date), r.time, r.sender, r.ctv, r.text, r.reason, false, '']);
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(start, REVIEW_HEADERS.indexOf('Duyệt') + 1, rows.length, 1).insertCheckboxes();
}

function appendLog_(sheet, s) {
  sheet.appendRow([
    new Date(), s.mode || '', s.received || 0, s.duplicates || 0, s.newMessages || 0,
    s.written || 0, s.review || 0, s.skipped || 0,
    s.error ? 'LỖI: ' + s.error : (s.rows && s.rows.length ? 'Dòng ' + s.rows[0] + '–' + s.rows[s.rows.length - 1] : ''),
  ]);
}

// ===================== Menu trong Sheet =====================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Đơn Zalo')
    .addItem('1. Cài đặt lần đầu', 'caiDatLanDau')
    .addItem('2. Đặt tab đang mở làm tab ghi đơn', 'datTabGhiDon')
    .addSeparator()
    .addItem('Chuyển các đơn đã duyệt (tab Cần kiểm tra)', 'chuyenDonDaDuyet')
    .addItem('Sắp xếp đơn theo ngày', 'sapXepTheoNgay')
    .addItem('Chạy thử bộ tách đơn với tin mẫu', 'chayThuTinMau')
    .addItem('Làm lại từ đầu (xóa lịch sử tin đã xử lý)', 'lamLaiTuDau')
    .addSeparator()
    .addItem('Xem mã bí mật (token)', 'xemMaBiMat')
    .addItem('Tạo mã bí mật mới', 'taoMaBiMatMoi')
    .addToUi();
}

function caiDatLanDau() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP.SPREADSHEET_ID, ss.getId());
  if (!props.getProperty(PROP.TOKEN)) props.setProperty(PROP.TOKEN, newToken_());
  ensureAuxSheets_(ss);

  let mainMsg;
  try {
    const main = getMainSheet_(ss);
    props.setProperty(PROP.MAIN_SHEET, main.getName());
    const n = applyCtvChoicesToMap_(ss);
    mainMsg = 'Tab ghi đơn: "' + main.getName() + '"\n' + (n
      ? '✓ Đã lấy ' + n + ' tên CTV từ ô chọn cột Tên CTV cho tab ' + CONFIG.CTV_MAP_SHEET + '.'
      : '⚠️ KHÔNG đọc được danh sách tên CTV từ cột Tên CTV' +
        (typeof Sheets === 'undefined'
          ? ' (chưa bật dịch vụ "Google Sheets API" trong Apps Script, xem README Bước 2).'
          : '. Gửi ảnh thông báo này cho người hỗ trợ.'));
  } catch (err) {
    mainMsg = 'CHƯA chọn được tab ghi đơn: ' + err.message;
  }
  ui.alert('Cài đặt xong',
    mainMsg + '\n\nMúi giờ dự án: ' + Session.getScriptTimeZone() + ' (cần là Asia/Ho_Chi_Minh)' +
    '\n\nMã bí mật (dán vào Cài đặt của userscript):\n' + props.getProperty(PROP.TOKEN) +
    '\n\nBước tiếp theo: Triển khai (Deploy) Web App theo README.', ui.ButtonSet.OK);
}

function datTabGhiDon() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!findHeaders_(sheet)) {
    ui.alert('Tab "' + sheet.getName() + '" không có đủ các cột ' + Object.values(CONFIG.HEADERS).join(' / ') + ' trong ' + CONFIG.HEADER_SEARCH_ROWS + ' dòng đầu.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(PROP.MAIN_SHEET, sheet.getName());
  applyCtvChoicesToMap_(SpreadsheetApp.getActiveSpreadsheet());
  ui.alert('Đã đặt tab ghi đơn là "' + sheet.getName() + '".');
}

function chuyenDonDaDuyet() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const sheet = ensureAuxSheets_(ss).review;
  const last = sheet.getLastRow();
  if (last < 2) { ui.alert('Tab Cần kiểm tra đang trống.'); return; }

  const col = name => REVIEW_HEADERS.indexOf(name);
  const main = getMainSheet_(ss);
  const choices = getCtvChoices_(main, findHeaders_(main));
  const ctvMap = loadCtvMap_(ensureAuxSheets_(ss).ctvMap).map;
  const data = sheet.getRange(2, 1, last - 1, REVIEW_HEADERS.length).getValues();
  const picked = [];
  const problems = [];
  data.forEach((row, i) => {
    if (row[col('Duyệt')] !== true || row[col('Trạng thái')]) return;
    const date = row[col('Ngày')];
    let ctv = String(row[col('Tên CTV')]).trim();
    if (!ctv) {
      // Ô Tên CTV trống: tra lại CTV_Map theo Tên Zalo (anh có thể vừa điền thêm vào CTV_Map).
      ctv = resolveCtv_(String(row[col('Tên Zalo')]).trim(), ctvMap, choices).ctv;
      if (ctv) sheet.getRange(i + 2, col('Tên CTV') + 1).setValue(ctv);
    }
    const text = String(row[col('Đơn Hàng')]).trim();
    if (!(date instanceof Date) || !ctv || !text) {
      problems.push('Dòng ' + (i + 2) + ': cần điền đủ Ngày (dạng ngày), Tên CTV, Đơn Hàng');
      return;
    }
    if (choices && !choices.has(norm_(ctv))) {
      problems.push('Dòng ' + (i + 2) + ': Tên CTV "' + ctv + '" không có trong ô chọn của cột Tên CTV');
      return;
    }
    picked.push({ row: i + 2, date, ctv: choices ? choices.get(norm_(ctv)) : ctv, text });
  });

  if (picked.length) {
    const appended = appendOrders_(main, picked);
    sortOrdersByDate_(main);
    // Sau khi sắp xếp, số dòng của đơn có thể còn đổi ở lần ghi sau, nên không ghi số dòng ở đây.
    picked.forEach(p => sheet.getRange(p.row, col('Trạng thái') + 1).setValue('Đã chuyển'));
    appendLog_(ensureAuxSheets_(ss).log, { mode: 'Duyệt tay', written: picked.length, rows: appended });
  }
  ui.alert('Đã chuyển ' + picked.length + ' đơn.' + (problems.length ? '\n\nChưa chuyển:\n' + problems.join('\n') : ''));
}

/** Sắp xếp các đơn đang có theo ngày (dùng khi anh tự gõ/sửa đơn tay trong tab đơn hàng). */
function sapXepTheoNgay() {
  sortOrdersByDate_(getMainSheet_(getSpreadsheet_()));
  SpreadsheetApp.getUi().alert('Đã sắp xếp các đơn theo ngày.');
}

function chayThuTinMau() {
  const samples = [
    { sender: 'CTV Mẫu', date: '2026-11-03', time: '10:01', text: '1 mì trộn bò mĩ 45k\n1 cơm thố xá xíu 40k\nShip 10k\nsđt:0900000001' },
    { sender: 'CTV Mẫu', date: '2026-11-03', time: '10:05', text: 'ok anh' },
    { sender: 'Người lạ', date: '2026-11-03', time: '10:06', text: '1 đùi gà 33k\nShip 15k\n0900000002' },
  ];
  samples.forEach((m, i) => { m.key = 'mau' + i; });
  const results = classifyMessages_(samples, new Map([[norm_('CTV Mẫu'), 'CTV Mẫu']]), CONFIG);
  const lines = results.map(r => '• ' + r.result.toUpperCase() + ' – ' + r.sender + (r.reason ? ' – ' + r.reason : ''));
  SpreadsheetApp.getUi().alert('Kết quả chạy thử (không ghi gì vào Sheet)',
    lines.join('\n') + '\n\nKỳ vọng: ORDER, SKIP, REVIEW (thiếu Tên CTV).', SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Quên các tin đã xử lý (tab _DaXuLy) và xóa tab Cần kiểm tra, để gom lại từ đầu.
 * Không đụng tab đơn hàng: anh phải tự xóa đơn cũ ở đó trước, nếu không sẽ bị ghi trùng.
 */
function lamLaiTuDau() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('Làm lại từ đầu',
    'Xóa lịch sử tin đã xử lý (tab _DaXuLy) và toàn bộ tab Cần kiểm tra?\n\n' +
    'Sau đó, mọi tin gom được sẽ được xử lý lại như mới.\n' +
    '⚠️ Chỉ làm khi anh ĐÃ XÓA các đơn cũ ở tab đơn hàng (cột Ngày, Đơn Hàng, Tên CTV). Nếu không, đơn sẽ bị ghi trùng.',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  const aux = ensureAuxSheets_(getSpreadsheet_());
  [aux.processed, aux.review].forEach(sh => {
    const last = sh.getLastRow();
    if (last < 2) return;
    const range = sh.getRange(2, 1, last - 1, sh.getLastColumn());
    range.clearContent();
    range.clearDataValidations(); // bỏ ô tick "Duyệt"
  });
  appendLog_(aux.log, { mode: 'Làm lại từ đầu' });
  ui.alert('Đã xóa lịch sử. Trên Zalo Web, bấm "Xóa bộ nhớ tạm", rồi "▶ Bắt đầu gom" và cuộn lại các đơn cần ghi.');
}

function xemMaBiMat() {
  const token = PropertiesService.getScriptProperties().getProperty(PROP.TOKEN);
  SpreadsheetApp.getUi().alert(token ? 'Mã bí mật:\n' + token : 'Chưa có mã. Chạy "Cài đặt lần đầu" trước.');
}

function taoMaBiMatMoi() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Tạo mã mới? Mã cũ sẽ hết hiệu lực, phải dán mã mới vào userscript.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const token = newToken_();
  PropertiesService.getScriptProperties().setProperty(PROP.TOKEN, token);
  ui.alert('Mã bí mật mới:\n' + token);
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}
