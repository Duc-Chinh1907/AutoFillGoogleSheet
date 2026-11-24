/**
 * Trang xem đơn trên điện thoại (dự án Apps Script riêng, không gắn với Sheet).
 *
 * Trang chạy bằng tài khoản Google của người đang xem, nên chỉ ai được chia sẻ Sheet mới đọc được dữ liệu.
 * Trang chỉ ĐỌC Sheet. Duyệt / bỏ qua đơn được gửi qua Web App đơn Zalo (apps-script/Code.gs), nơi ghi
 * có khóa, để không ghi đè lên lúc Zalo Web cũng đang ghi đơn.
 *
 * Thuộc tính tập lệnh (Cài đặt dự án → Thuộc tính tập lệnh), không nằm trong code:
 *   SPREADSHEET_ID  : mã Sheet (đoạn giữa /d/ và /edit trong link Sheet)
 *   INGEST_URL      : URL Web App đơn Zalo (kết thúc bằng /exec)
 *   API_TOKEN       : mã bí mật (Sheet → Đơn Zalo → Xem mã bí mật)
 *   MAIN_SHEET_NAME : (không bắt buộc) tên tab đơn hàng; để trống thì tự tìm tab có cột Ngày / Đơn Hàng / Tên CTV
 */

const DB = {
  REVIEW_SHEET: 'Cần kiểm tra',
  CTV_MAP_SHEET: 'CTV_Map',
  HEADER_SEARCH_ROWS: 5,
  COLS: {
    date: 'Ngày', order: 'Đơn Hàng', ctv: 'Tên CTV',
    total: 'Tổng tiền hàng', discount: 'Tổng chiết khấu', ctvDiscount: 'Chiết khấu (CTV)',
  },
  REQUIRED: ['date', 'order', 'ctv'],
  REVIEW_COLS: ['Nhận lúc', 'Ngày', 'Giờ', 'Tên Zalo', 'Tên CTV', 'Đơn Hàng', 'Lý do', 'Duyệt', 'Trạng thái'],
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Đơn Zalo')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ===================== Hàm thuần (có test trong tests/) =====================

function dbNorm_(s) {
  return String(s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Vị trí các cột (tính từ 0) theo dòng tiêu đề; cột không có thì -1; thiếu cột bắt buộc thì null. */
function dbFindCols_(headerRow) {
  const cells = headerRow.map(dbNorm_);
  const out = {};
  Object.keys(DB.COLS).forEach(k => { out[k] = cells.indexOf(dbNorm_(DB.COLS[k])); });
  return DB.REQUIRED.every(k => out[k] >= 0) ? out : null;
}

/**
 * Tổng hợp một ngày. rows: [{ day: 'YYYY-MM-DD', total, discount, ctv, ctvDiscount }].
 * Ô trống / lỗi công thức tính là 0. Bảng theo CTV xếp theo chiết khấu CTV giảm dần.
 */
function dbSummarize_(rows, day) {
  const list = rows.filter(r => r.day === day);
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const groups = new Map();
  list.forEach(r => {
    const k = r.ctv || '(chưa có tên)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  return {
    day,
    count: list.length,
    total: sum(list, 'total'),
    discount: sum(list, 'discount'),
    ctvDiscount: sum(list, 'ctvDiscount'),
    byCtv: Array.from(groups, ([ctv, arr]) => ({ ctv, count: arr.length, total: sum(arr, 'total'), ctvDiscount: sum(arr, 'ctvDiscount') }))
      .sort((a, b) => b.ctvDiscount - a.ctvDiscount || a.ctv.localeCompare(b.ctv)),
  };
}

/** Bỏ trùng (không phân biệt hoa/thường, khoảng trắng), bỏ ô trống, giữ cách viết đầu tiên, xếp A→Z. */
function dbUniqueNames_(names) {
  const seen = new Map();
  names.map(n => String(n).trim()).filter(Boolean).forEach(n => { if (!seen.has(dbNorm_(n))) seen.set(dbNorm_(n), n); });
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'vi'));
}

// ===================== Đọc Sheet (bằng tài khoản người đang xem) =====================

function dbOpen_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Chưa cài SPREADSHEET_ID trong Thuộc tính tập lệnh của trang xem đơn.');
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    // Ghi rõ tài khoản đang chạy và lỗi gốc: hay gặp nhất là trình duyệt đăng nhập nhiều tài khoản
    // nên trang chạy bằng tài khoản khác, hoặc chia sẻ nhầm file khác với SPREADSHEET_ID.
    let who = '';
    try { who = Session.getActiveUser().getEmail(); } catch (e) { /* không lấy được email thì thôi */ }
    throw new Error('Tài khoản ' + (who || '(không rõ)') + ' chưa mở được Sheet đơn hàng (mã ' + id + '). ' +
      'Nhờ chủ Sheet chia sẻ đúng file này cho đúng tài khoản này rồi tải lại trang. Lỗi gốc: ' + (err && err.message || err));
  }
}

/** Tab đơn hàng và vị trí cột: { sheet, headerRow (tính từ 0), cols }. */
function dbMainSheet_(ss) {
  const find = sheet => {
    const n = Math.min(DB.HEADER_SEARCH_ROWS, sheet.getLastRow());
    if (!n || !sheet.getLastColumn()) return null;
    const head = sheet.getRange(1, 1, n, sheet.getLastColumn()).getDisplayValues();
    for (let r = 0; r < head.length; r++) {
      const cols = dbFindCols_(head[r]);
      if (cols) return { sheet, headerRow: r, cols };
    }
    return null;
  };
  const name = PropertiesService.getScriptProperties().getProperty('MAIN_SHEET_NAME');
  if (name) {
    const hit = ss.getSheetByName(name) && find(ss.getSheetByName(name));
    if (!hit) throw new Error('Không thấy tab "' + name + '" có cột ' + DB.REQUIRED.map(k => DB.COLS[k]).join(' / ') + '.');
    return hit;
  }
  // Tab Cần kiểm tra cũng có cột Ngày / Đơn Hàng / Tên CTV: không tính các tab phụ khi tự tìm.
  const aux = [DB.REVIEW_SHEET, DB.CTV_MAP_SHEET, 'Nhật ký', '_DaXuLy'];
  const hits = ss.getSheets().filter(s => !aux.includes(s.getName())).map(find).filter(Boolean);
  if (hits.length === 1) return hits[0];
  throw new Error(hits.length
    ? 'Có nhiều tab có cột đơn hàng (' + hits.map(h => h.sheet.getName()).join(', ') + '). Đặt MAIN_SHEET_NAME trong Thuộc tính tập lệnh.'
    : 'Không tìm thấy tab đơn hàng.');
}

function dbCtvChoices_(ss) {
  const map = ss.getSheetByName(DB.CTV_MAP_SHEET);
  const names = [];
  if (map) {
    // Ô chọn ở CTV_Map cột B được "Cài đặt lần đầu" lấy từ cột Tên CTV của tab đơn hàng.
    const rule = map.getRange('B2').getDataValidation();
    if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      names.push(...rule.getCriteriaValues()[0]);
    } else if (map.getLastRow() >= 2) {
      names.push(...map.getRange(2, 2, map.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]));
    }
  }
  return dbUniqueNames_(names);
}

// ===================== Gọi từ trang (google.script.run) =====================

/** Số liệu một ngày (mặc định hôm nay) và danh sách các ngày có đơn. */
function layTongQuan(day) {
  const ss = dbOpen_();
  const tz = ss.getSpreadsheetTimeZone();
  const m = dbMainSheet_(ss);
  const c = m.cols;
  const values = m.sheet.getDataRange().getValues().slice(m.headerRow + 1);
  const rows = values
    .filter(r => r[c.date] instanceof Date && String(r[c.order]).trim())
    .map(r => ({
      day: Utilities.formatDate(r[c.date], tz, 'yyyy-MM-dd'),
      ctv: String(r[c.ctv]).trim(),
      total: c.total >= 0 ? r[c.total] : 0,
      discount: c.discount >= 0 ? r[c.discount] : 0,
      ctvDiscount: c.ctvDiscount >= 0 ? r[c.ctvDiscount] : 0,
    }));
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const days = Array.from(new Set(rows.map(r => r.day))).sort().reverse();
  const wanted = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : today;
  return Object.assign(dbSummarize_(rows, wanted), {
    today,
    days: days.slice(0, 90),
    missing: Object.keys(DB.COLS).filter(k => c[k] < 0).map(k => DB.COLS[k]),
  });
}

/** Các đơn ở tab Cần kiểm tra chưa xử lý (cột Trạng thái trống) và danh sách tên CTV để chọn. */
function layCanKiemTra() {
  const ss = dbOpen_();
  const tz = ss.getSpreadsheetTimeZone();
  const choices = dbCtvChoices_(ss);
  const sh = ss.getSheetByName(DB.REVIEW_SHEET);
  if (!sh || sh.getLastRow() < 2) return { rows: [], choices };
  const c = name => DB.REVIEW_COLS.indexOf(name);
  const fmt = (v, pattern) => (v instanceof Date ? Utilities.formatDate(v, tz, pattern) : String(v || '').trim());
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, DB.REVIEW_COLS.length).getValues()
    .map((r, i) => ({
      row: i + 2,
      receivedAt: r[0] instanceof Date ? r[0].getTime() : null,
      date: r[c('Ngày')] instanceof Date ? fmt(r[c('Ngày')], 'yyyy-MM-dd') : '',
      time: fmt(r[c('Giờ')], 'HH:mm'), // Sheets có thể tự đổi "10:05" thành kiểu giờ
      sender: String(r[c('Tên Zalo')]).trim(),
      ctv: String(r[c('Tên CTV')]).trim(),
      text: String(r[c('Đơn Hàng')]),
      reason: String(r[c('Lý do')]).trim(),
      status: String(r[c('Trạng thái')]).trim(),
    }))
    .filter(r => r.receivedAt && !r.status && r.text.trim());
  return { rows, choices };
}

/** Sửa rồi chuyển một đơn sang tab đơn hàng. p: { row, receivedAt, date, ctv, text } */
function duyetDon(p) {
  dbOpen_(); // chỉ người được chia sẻ Sheet mới duyệt được
  return dbCallIngest_({ op: 'transfer', row: p.row, receivedAt: p.receivedAt, date: p.date, ctv: p.ctv, text: p.text });
}

/** Đánh dấu bỏ qua một đơn (không chuyển). p: { row, receivedAt } */
function boQuaDon(p) {
  dbOpen_();
  return dbCallIngest_({ op: 'skip', row: p.row, receivedAt: p.receivedAt });
}

function dbCallIngest_(payload) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('INGEST_URL');
  const token = props.getProperty('API_TOKEN');
  if (!url || !token) throw new Error('Chưa cài INGEST_URL / API_TOKEN trong Thuộc tính tập lệnh của trang xem đơn.');
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(Object.assign({ token, action: 'review', by: Session.getActiveUser().getEmail() }, payload)),
    muteHttpExceptions: true,
  });
  let data;
  try {
    data = JSON.parse(res.getContentText());
  } catch (err) {
    throw new Error('Web App đơn Zalo trả về không phải JSON (HTTP ' + res.getResponseCode() + '). Kiểm tra INGEST_URL.');
  }
  if (!data.ok) throw new Error(data.error);
  return data;
}
