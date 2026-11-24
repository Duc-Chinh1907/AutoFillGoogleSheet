// Chạy: ./tests/run.sh  (dùng JavaScriptCore có sẵn trên macOS, không cần cài gì)
// Kiểm tra các hàm thuần trong apps-script/Code.gs, dashboard/Dashboard.gs và userscript/zalo-don-hang.user.js.
load('apps-script/Code.gs');
load('dashboard/Dashboard.gs');
load('userscript/zalo-don-hang.user.js');

let passed = 0;
let failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; print('FAIL ' + name + '\n   nhận: ' + a + '\n   cần : ' + e); }
}

// Số điện thoại trong test là số giả.
const ORDER_1 = '1 mì trộn bò mĩ 45k\n1 cơm thố xá xíu 40k\n1 khoai tây chiên 25k\nTẶNG 1 nước\nShip 10k\nhttps://maps.app.goo.gl/AAAAAAAAAAAAAAAAA?g_st=ic\nsđt:0900000001';
const ORDER_2 = '1 pizza chicago L xúc xích 199k\n1 khoai tây chiên 25k\n1 đùi gà 33k\nTẶNG 2 nước\nShip 15k\nCc phenika\n0900000002';
const ORDER_3 = '1 combo 260k\npizza 120k\n ( lấy trà chanh) \n1 mì cay thập cẩm 60k\nSdt 090 0000003\nShip 20k\nhttps://maps.app.goo.gl/BBBBBBBBBBBBBBBBB?g_st=ic\nCk';

const MAP = new Map([['lan ctv', 'Lan'], ['minh', 'Minh']]);
let seq = 0;
const msg = (sender, text, extra) => Object.assign({ key: 'k' + (seq++), sender, date: '2026-11-03', time: '10:00', mine: false, text }, extra || {});
const run = list => classifyMessages_(list, MAP, CONFIG).map(r => [r.result, r.ctv, r.keys.length]);

// --- 3 đơn mẫu thật ---
eq(run([msg('Lan CTV', ORDER_1)]), [['order', 'Lan', 1]], 'đơn mẫu 1');
eq(run([msg('Lan CTV', ORDER_2)]), [['order', 'Lan', 1]], 'đơn mẫu 2');
eq(run([msg('Lan CTV', ORDER_3)]), [['order', 'Lan', 1]], 'đơn mẫu 3');
eq(classifyMessages_([msg('Lan CTV', ORDER_1)], MAP, CONFIG)[0].text, ORDER_1, 'ghi nguyên văn tin vào Đơn Hàng');

// --- tin trò chuyện / tin của mình ---
eq(run([msg('Lan CTV', 'ok anh, đơn này làm gấp giúp em nhé')]), [['skip', '', 1]], 'tin trò chuyện bị bỏ qua');
eq(run([msg('', ORDER_1, { mine: true })]), [['skip', '', 1]], 'tin của mình bị bỏ qua');
eq(run([msg('Lan CTV', 'Ship 15k nha anh')]), [['review', 'Lan', 1]], 'có giá nhưng không có món → cần kiểm tra (vẫn điền sẵn Tên CTV)');
eq(run([msg('Người lạ', 'Ship 15k nha anh')]), [['review', '', 1]], 'không có trong CTV_Map → Tên CTV trống');
eq(run([msg('Lan CTV', '150k')]), [['review', 'Lan', 1]], '"150k" đứng riêng: Sheet tính là món, nhưng thiếu SĐT → cần kiểm tra');

// --- khớp quy tắc công thức "Tổng tiền hàng" của Sheet (dòng bắt đầu bằng số, kết thúc "…k") ---
eq(run([msg('Lan CTV', '1 cơm thố 40K\nShip 10k\n0900000001')]), [['review', 'Lan', 1]], 'giá "40K" hoa → Sheet không tính được → cần kiểm tra');
eq(run([msg('Lan CTV', '2 trà chanh 30.000đ\nShip 10k\n0900000001')]), [['review', 'Lan', 1]], 'giá "30.000đ" → cần kiểm tra');
eq(run([msg('Lan CTV', '  1 mì   trộn 45k  \nShip 10k\n0900000001')]), [['order', 'Lan', 1]], 'thừa dấu cách vẫn nhận (giống TRIM)');
eq(run([msg('Lan CTV', '1 cơm thố 40K'), msg('Lan CTV', 'sđt 0900000001')]), [['review', 'Lan', 2]], 'tin bổ sung vẫn gộp vào đơn cần kiểm tra');
eq(classifyMessages_([msg('Lan CTV', '1 cơm thập cẩm 75k \n\nyoung house  \n0900000001')], MAP, CONFIG)[0].text,
  '1 cơm thập cẩm 75k\n\nyoung house\n0900000001', 'bỏ dấu cách cuối dòng (tránh #N/A ở cột Tổng tiền hàng)');

// --- tên CTV phải có trong ô chọn của cột Tên CTV ---
const CHOICES = new Map([['lan', 'Lan'], ['quân-nhi', 'Quân-Nhi']]);
const runC = (list, map) => classifyMessages_(list, map, CONFIG, CHOICES).map(r => [r.result, r.ctv]);
eq(runC([msg('Lan CTV', ORDER_1)], MAP), [['order', 'Lan']], 'tên có trong ô chọn');
eq(runC([msg('Minh', ORDER_1)], MAP), [['review', '']], 'tên không có trong ô chọn → cần kiểm tra');
eq(runC([msg('Nhi', ORDER_1)], new Map([['nhi', 'quân-nhi']])), [['order', 'Quân-Nhi']], 'ghi đúng chữ hoa/thường theo ô chọn');

// --- thiếu trường bắt buộc ---
eq(run([msg('Lan CTV', '1 đùi gà 33k')]), [['review', 'Lan', 1]], 'có món nhưng không SĐT/ship/link → cần kiểm tra');
eq(run([msg('Người lạ', ORDER_2)]), [['review', '', 1]], 'chưa có trong CTV_Map → cần kiểm tra');
eq(run([msg('Lan CTV', ORDER_2, { date: '' })]), [['review', 'Lan', 1]], 'không rõ ngày → cần kiểm tra');
eq(run([msg('', ORDER_2)]), [['review', '', 1]], 'không rõ người gửi → cần kiểm tra');

// --- gộp tin bổ sung ---
eq(run([msg('Lan CTV', '1 đùi gà 33k\n1 khoai tây chiên 25k', { time: '10:00' }), msg('Lan CTV', 'sđt 0900000004\nShip 10k', { time: '10:02' })]),
  [['order', 'Lan', 2]], 'gộp SĐT gửi ngay sau đơn');
eq(run([msg('Lan CTV', '1 đùi gà 33k', { time: '10:00' }), msg('Lan CTV', '0900000004', { time: '10:30' })]),
  [['review', 'Lan', 1], ['review', 'Lan', 1]], 'không gộp khi cách quá 5 phút');
eq(run([msg('Lan CTV', '1 đùi gà 33k'), msg('Minh', '0900000004'), msg('Lan CTV', 'ship 10k')]),
  [['review', 'Lan', 1], ['review', 'Minh', 1], ['review', 'Lan', 1]], 'không gộp khi người khác chen giữa');
eq(run([msg('Lan CTV', ORDER_1), msg('Lan CTV', 'cảm ơn anh')]), [['order', 'Lan', 1], ['skip', '', 1]], 'không gộp câu trò chuyện vào đơn');
eq(run([msg('Lan CTV', ORDER_1), msg('Lan CTV', ORDER_2)]), [['order', 'Lan', 1], ['order', 'Lan', 1]], '2 đơn liên tiếp là 2 đơn');

// --- nhận diện SĐT ---
eq(features_('Sdt 090 0000003').hasPhone, true, 'SĐT có dấu cách');
eq(features_('+84 900 000 005').hasPhone, true, 'SĐT +84');
eq(features_('mã 1234567890123').hasPhone, false, 'dãy số dài không phải SĐT');

// --- đọc vạch ngày (userscript) ---
const NOW = new Date(2026, 10, 3, 9, 0); // Thứ Ba 03/11/2026
eq(parseDividerDate('Hôm nay', NOW), '2026-11-03', 'Hôm nay');
eq(parseDividerDate('14:20 Hôm qua', NOW), '2026-11-02', 'Hôm qua có giờ');
eq(parseDividerDate('02/11/2026', NOW), '2026-11-02', 'dd/mm/yyyy');
eq(parseDividerDate('Thứ Hai, 02/11', NOW), '2026-11-02', 'thứ + dd/mm');
eq(parseDividerDate('Thứ Hai', NOW), '2026-11-02', 'Thứ Hai');
eq(parseDividerDate('Chủ nhật', NOW), '2026-11-01', 'Chủ nhật');
eq(parseDividerDate('Thứ Ba', NOW), '2026-10-27', 'cùng thứ hôm nay → tuần trước');
eq(parseDividerDate('28/12', new Date(2027, 0, 5)), '2026-12-28', 'dd/mm năm trước');
eq(parseDividerDate('31/02/2026', NOW), null, 'ngày không tồn tại');
eq(parseDividerDate('Tin nhắn đã được ghim', NOW), null, 'chữ lạ → không đoán');
eq(parseTime('9:05'), '09:05', 'giờ');

// --- che chữ khi chẩn đoán ---
eq(maskText('14:30'), '14:30', 'giữ giờ');
eq(maskText('Hôm nay'), 'Hôm nay', 'giữ Hôm nay');
eq(maskText('Thứ Hai, 02/11/2026'), 'Thứ Hai, 02/11/2026', 'giữ vạch ngày');
eq(maskText('1 mì trộn 45k'), '[13 ký tự]', 'che nội dung đơn');
eq(maskText('Chủ nhật ơi gọi lại'), '[19 ký tự]', 'che câu bắt đầu bằng Chủ nhật');

// --- ghép thứ tự khi cuộn ---
const order = [];
const store = new Map();
const m = uid => ({ uid });
eq(mergeSnapshot(order, store, [m('c'), m('d'), m('e')]), 3, 'lần quét 1');
eq(mergeSnapshot(order, store, [m('a'), m('b'), m('c')]), 2, 'lần quét 2 (cuộn lên)');
eq(mergeSnapshot(order, store, [m('d'), m('e'), m('f')]), 1, 'lần quét 3 (cuộn xuống)');
eq(order, ['a', 'b', 'c', 'd', 'e', 'f'], 'thứ tự đúng');

// --- bỏ chọn ở bảng Xem trước ---
const skipRes = [
  { result: 'order', reason: '', keys: ['a'] },
  { result: 'review', reason: 'x', keys: ['b', 'c'] },
  { result: 'skip', reason: 'Tin trò chuyện, không phải đơn', keys: ['d'] },
  { result: 'order', reason: '', keys: ['e'] },
];
eq(applyUserSkips_(skipRes, new Set(['a', 'c', 'd'])), 2, 'đếm số đơn bị bỏ chọn (không tính tin vốn đã bỏ qua)');
eq(skipRes.map(r => r.result), ['skip', 'skip', 'skip', 'order'], 'đơn bỏ chọn chuyển thành bỏ qua, đơn khác giữ nguyên');
eq(skipRes[1].reason, 'Anh bỏ chọn khi xem trước', 'ghi lý do bỏ chọn (kể cả khi chỉ bỏ chọn 1 tin trong đơn gộp)');
eq(skipRes[2].reason, 'Tin trò chuyện, không phải đơn', 'tin vốn bỏ qua giữ lý do cũ');

// --- sắp xếp đơn theo ngày ---
const D = (d) => new Date(2026, 10, d);
eq(dateOrder_([D(3), D(1), D(2)]), [1, 2, 0], 'sắp theo ngày');
eq(dateOrder_([D(2), D(1), D(2), D(1)]), [1, 3, 0, 2], 'cùng ngày giữ thứ tự cũ');
eq(dateOrder_(['', D(1), 'chữ', D(1)]), [1, 3, 0, 2], 'ô trống / không phải ngày xuống cuối');
eq(dateOrder_([D(1), D(2)]), [0, 1], 'đã đúng thứ tự thì không đổi');

// --- dọn lịch sử _DaXuLy ---
const CUT = D(10).getTime();
eq(countExpired_([D(1), D(5), D(10), D(12)], CUT), 2, 'xóa các dòng trước hạn ở đầu danh sách');
eq(countExpired_([D(1), D(11), D(2)], CUT), 1, 'dừng ở dòng đầu tiên chưa quá hạn');
eq(countExpired_(['', D(1)], CUT), 0, 'dòng đầu trống thì không xóa gì');
eq(countExpired_([], CUT), 0, 'tab trống');

// --- trang xem đơn (dashboard) ---
eq(dbFindCols_(['Ngày', 'Mã Đơn ID', 'Đơn Hàng', 'Tổng tiền hàng', 'Tổng chiết khấu', 'Tên CTV', 'Chiết khấu (CTV)']),
  { date: 0, order: 2, ctv: 5, total: 3, discount: 4, ctvDiscount: 6 }, 'tìm đủ các cột theo tiêu đề');
eq(dbFindCols_([' ngày ', 'ĐƠN HÀNG', 'Tên  CTV']), { date: 0, order: 1, ctv: 2, total: -1, discount: -1, ctvDiscount: -1 },
  'tiêu đề khác hoa/thường, thừa dấu cách vẫn nhận; cột không bắt buộc thiếu thì -1');
eq(dbFindCols_(['Ngày', 'Đơn Hàng']), null, 'thiếu cột bắt buộc (Tên CTV) → null');

const DAY_ROWS = [
  { day: '2026-11-24', ctv: 'Lan', total: 100000, discount: 10000, ctvDiscount: 8000 },
  { day: '2026-11-24', ctv: 'Minh', total: 200000, discount: 20000, ctvDiscount: 20000 },
  { day: '2026-11-24', ctv: 'Lan', total: 50000, discount: '', ctvDiscount: '#N/A' },
  { day: '2026-11-24', ctv: '', total: 30000, discount: 3000, ctvDiscount: 2400 },
  { day: '2026-11-23', ctv: 'Lan', total: 999000, discount: 1, ctvDiscount: 1 },
];
const SUM = dbSummarize_(DAY_ROWS, '2026-11-24');
eq([SUM.count, SUM.total, SUM.discount, SUM.ctvDiscount], [4, 380000, 33000, 30400], 'tổng một ngày (ô trống / lỗi tính 0, bỏ ngày khác)');
eq(SUM.byCtv.map(r => [r.ctv, r.count, r.total, r.ctvDiscount]),
  [['Minh', 1, 200000, 20000], ['Lan', 2, 150000, 8000], ['(chưa có tên)', 1, 30000, 2400]], 'theo CTV, xếp theo chiết khấu CTV giảm dần');
eq(dbSummarize_(DAY_ROWS, '2026-11-01').count, 0, 'ngày không có đơn');
eq(dbUniqueNames_(['Lan', ' lan ', '', 'Ánh', 'Minh', 'Minh']), ['Ánh', 'Lan', 'Minh'], 'danh sách tên CTV: bỏ trùng, bỏ trống, xếp A→Z');

print('\n' + passed + ' đạt, ' + failed + ' lỗi');
if (failed) throw new Error('Có test lỗi');
