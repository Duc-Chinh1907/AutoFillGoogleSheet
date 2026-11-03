# Đơn Zalo → Google Sheet

Lấy đơn CTV gửi trong nhóm Zalo và ghi vào Google Sheet, thay cho việc nhập tay.

```
 Chrome (chat.zalo.me)                        Google Sheet
 ┌──────────────────────────┐   gửi tin    ┌──────────────────────────────┐
 │ Userscript (Tampermonkey)│ ───────────▶ │ Apps Script (Web App)        │
 │ - đọc tin đang hiện      │   + mã bí mật│ - tách đơn, chống trùng      │
 │ - nút Xem trước / Ghi    │ ◀─────────── │ - ghi Ngày / Đơn Hàng / CTV  │
 └──────────────────────────┘   kết quả    │ - tab Cần kiểm tra, Nhật ký  │
                                           └──────────────────────────────┘
```

- **Chỉ đọc Zalo**: script chỉ đọc chữ đang hiện trên màn hình. Nó không gửi tin, không bấm gì trong nhóm và không gọi máy chủ Zalo.
- **Chỉ ghi 3 cột**: `Ngày`, `Đơn Hàng` (nguyên văn tin của CTV) và `Tên CTV`. Mã đơn, tổng tiền, chiết khấu... vẫn do công thức của Sheet tự tính.
- **Không ghi trùng**: tin nào đã xử lý thì lần sau bỏ qua, kể cả khi anh bấm Ghi nhiều lần.
- **Không đoán bừa**: tin thiếu thông tin được ghi sang tab **Cần kiểm tra** để anh duyệt tay.

## Trong thư mục này có gì

| File | Dùng để |
|---|---|
| `apps-script/Code.gs` | Code dán vào Apps Script của Google Sheet |
| `apps-script/appsscript.json` | Cấu hình dự án (múi giờ Việt Nam). Chỉ cần nếu anh dùng `clasp`, dán tay thì bỏ qua |
| `userscript/zalo-don-hang.user.js` | Script cài vào Tampermonkey trên Chrome |
| `tests/` | Kiểm tra bộ tách đơn: chạy `./tests/run.sh` trong Terminal |

---

## Cài đặt (làm một lần, khoảng 20 phút)

> ⚠️ **Làm trên bản sao của Sheet trước.** Khi chạy ổn mới làm lại trên Sheet thật (xem Bước 9).

### Bước 1: Tạo bản sao Sheet để thử

1. Mở Google Sheet đơn hàng.
2. Chọn **Tệp → Tạo bản sao**, đặt tên ví dụ `ĐƠN HÀNG – BẢN THỬ`, rồi bấm **Tạo bản sao**.
3. Từ đây đến Bước 8, mọi thao tác làm trên **bản sao** này.

### Bước 2: Dán code vào Apps Script

1. Trong bản sao, chọn menu **Tiện ích mở rộng → Apps Script**. Một tab mới mở ra.
2. Bên trái đang có file `Code.gs` với vài dòng mẫu. Xóa hết các dòng đó.
3. Mở file `apps-script/Code.gs` trong thư mục này (bằng TextEdit hoặc VS Code), chọn tất cả (**Cmd+A**), chép (**Cmd+C**), rồi dán (**Cmd+V**) vào Apps Script.
4. Bấm biểu tượng 💾 (**Lưu**).
5. Bên trái, bấm ⚙️ **Cài đặt dự án**. Ở mục **Múi giờ**, chọn **(GMT+07:00) Giờ Đông Dương – Hồ Chí Minh**.
6. Bật dịch vụ **Google Sheets API**. Cần bước này để script đọc được danh sách tên CTV trong cột "Menu thả xuống" của Bảng:
   - Quay lại màn hình code (biểu tượng `< >` bên trái).
   - Ở cột bên trái, cạnh chữ **Dịch vụ** (*Services*), bấm dấu **+**.
   - Chọn **Google Sheets API** trong danh sách, giữ nguyên tên `Sheets`, bấm **Thêm**.

### Bước 3: Cài đặt lần đầu trong Sheet

1. Quay lại tab Google Sheet và tải lại trang (**Cmd+R**). Trên thanh menu sẽ có thêm mục **Đơn Zalo**.
2. Chọn **Đơn Zalo → 1. Cài đặt lần đầu**.
3. Google sẽ hỏi cấp quyền: bấm **Tiếp tục**, chọn tài khoản của anh.
   - Nếu hiện *"Google chưa xác minh ứng dụng này"*: bấm **Nâng cao → Đi tới … (không an toàn)**. Cảnh báo này xuất hiện vì đây là script anh tự tạo, chưa gửi Google duyệt.
   - Bấm **Cho phép**.
4. Chọn lại **Đơn Zalo → 1. Cài đặt lần đầu**. Một hộp thoại hiện ra:
   - **Tab ghi đơn**: kiểm tra đúng tab đơn hàng chưa. Nếu báo *"CHƯA chọn được"* (vd. vì Sheet có nhiều tab tháng), hãy mở đúng tab đơn hàng rồi chọn **Đơn Zalo → 2. Đặt tab đang mở làm tab ghi đơn**.
   - **Múi giờ** phải là `Asia/Ho_Chi_Minh`.
   - **Mã bí mật**: một dãy ký tự dài. Chép lại để dùng ở Bước 6. Lúc nào cần xem lại thì vào **Đơn Zalo → Xem mã bí mật**.
5. Sheet sẽ có thêm 3 tab mới là **Cần kiểm tra**, **CTV_Map** và **Nhật ký**, cùng một tab ẩn `_DaXuLy`. **Không xóa** tab `_DaXuLy` vì nó dùng để chống trùng. Tab này chỉ nhớ các tin trong **60 ngày gần nhất**, tin cũ hơn được tự xóa sau mỗi lần ghi, nên không phình to mãi.
6. (Nên làm) Chọn **Đơn Zalo → Chạy thử bộ tách đơn với tin mẫu**. Kết quả đúng là `ORDER, SKIP, REVIEW`.

### Bước 4: Triển khai Web App

1. Trong tab Apps Script, bấm nút xanh **Triển khai → Tùy chọn triển khai mới**.
2. Bấm ⚙️ cạnh chữ *Chọn loại* và chọn **Ứng dụng web**.
3. Điền như sau:
   - Mô tả: `Đơn Zalo`
   - **Thực thi với tư cách**: **Tôi**
   - **Người có quyền truy cập**: **Bất kỳ ai**
4. Bấm **Triển khai**, rồi chép **URL ứng dụng web**. URL có dạng `https://script.google.com/macros/s/…/exec`.

> Chọn "Bất kỳ ai" là để script trên Zalo Web gửi dữ liệu vào được. Ai không có **mã bí mật** thì gửi gì lên cũng bị từ chối. Đừng chia sẻ URL và mã bí mật cho người khác.

### Bước 5: Cài Tampermonkey trên Chrome

1. Vào Chrome Web Store, tìm **Tampermonkey** và bấm **Thêm vào Chrome**.
2. Mở địa chỉ `chrome://extensions`, bấm **Chi tiết** ở Tampermonkey, rồi bật **Cho phép tập lệnh của người dùng** (*Allow User Scripts*). Nếu không thấy mục này, bật **Chế độ dành cho nhà phát triển** ở góc trên bên phải.
3. Mở link sau trong Chrome:
   https://raw.githubusercontent.com/Duc-Chinh1907/AutoFillGoogleSheet/main/userscript/zalo-don-hang.user.js
4. Tampermonkey sẽ hiện trang cài đặt script. Bấm **Cài đặt** (*Install*). Nếu đã cài trước đó thì nút sẽ là **Cập nhật** hoặc **Cài đặt lại**.

Cài từ link này thì Tampermonkey **tự cập nhật** khi có bản mới trên GitHub (mặc định kiểm tra mỗi ngày), anh không phải dán code nữa.

(Firefox và Edge cũng có Tampermonkey, làm tương tự.)

### Bước 6: Cài đặt script trên Zalo Web

1. Mở `https://chat.zalo.me` rồi mở **nhóm đơn hàng**.
2. Góc dưới bên phải sẽ có khung **📋 Đơn Zalo → Sheet**. Bấm **Cài đặt**, các ô nhập sẽ hiện ra ngay trong khung:
   1. **URL Web App**: dán URL lấy ở Bước 4.
   2. **Mã bí mật**: dán mã lấy ở Bước 3.
   3. **Tên nhóm**: bấm nút **Lấy tên nhóm đang mở** để script tự điền.
   4. **Tự động ghi mỗi … phút**: tạm để **0** (tắt).
   - **Mỗi ô tự lưu ngay khi anh dán xong** (dòng trạng thái hiện "✓ Đã lưu"). Anh cứ sang tab khác copy rồi quay lại, những ô đã điền vẫn còn, kể cả khi tải lại trang. Không cần điền hết một lượt.
3. Bấm **Đóng cài đặt**. Dòng trạng thái phải hiện **"✓ đang mở"**.

URL và mã bí mật được lưu trong Tampermonkey trên máy anh, không nằm trong code.

### Bước 7: Thử Xem trước và kiểm tra script đọc đúng chưa

1. Cuộn tới chỗ bắt đầu cần lấy, bấm **▶ Bắt đầu gom** (nút chuyển sang màu xanh, ghi "⏸ Dừng gom"), rồi cuộn qua vài đơn của hôm nay. Chỉ khi đang bật gom thì script mới đọc các tin đi qua màn hình. Ngay lúc bấm, nó lấy luôn **mọi tin Zalo đã tải sẵn** trong khung chat. Khi anh cuộn lên tới đơn đầu ngày, Zalo đã tải toàn bộ tin từ đó đến tin mới nhất, nên con số có thể lên vài trăm ngay lập tức. Như vậy là bình thường, không cần cuộn xuống lại. Mỗi lần bấm **▶ Bắt đầu gom** là một lượt mới, số "đã gom" đếm lại từ 0. Nếu lượt trước còn tin chưa ghi, script sẽ hỏi anh có bỏ các tin đó không. Mỗi lần tải lại trang, chế độ gom tự tắt.
2. Bấm **Xem trước**. Một bảng hiện ra, **chưa ghi gì vào Sheet**:
   - 🟩 **Ghi**: đơn hợp lệ
   - 🟨 **Cần kiểm tra**: kèm lý do
   - ⬜ **Bỏ qua**: tin trò chuyện hoặc tin của anh
3. Kiểm tra cột **Ngày**, **Tên Zalo** và **Đơn Hàng** có đúng không.

**Nếu bảng trống, sai người gửi hoặc ngày toàn "?"**: Zalo không công bố cấu trúc trang web, nên lần đầu có thể phải chỉnh *bộ chọn* (selector). Làm như sau:

1. Bấm **Chẩn đoán**.
2. Bấm vào **nội dung một tin nhắn đơn**, sau đó bấm vào **tên nhóm** ở đầu khung chat. Hai cú bấm này bị script chặn lại nên Zalo không phản ứng gì.
3. Kết quả đã được chép vào bộ nhớ tạm. Dán (**Cmd+V**) vào tin nhắn gửi cho người hỗ trợ (em). **Nội dung tin đã được che** thành dạng `[45 ký tự]`; chỉ còn giờ, chữ trên vạch ngày và tên lớp HTML.
4. Người hỗ trợ sẽ gửi lại một đoạn JSON. Anh bấm **Cài đặt** và dán đoạn đó vào ô **Nâng cao: bộ chọn tùy chỉnh**. Không cần sửa code.

### Bước 8: Điền tên CTV rồi ghi thử

1. Sau lần Xem trước, mở tab **CTV_Map** trong Sheet. Cột A đã có sẵn tên Zalo của các CTV vừa gửi đơn.
2. Ở **cột B**, **chọn Tên CTV từ ô chọn**. Danh sách này lấy từ ô chọn của cột Tên CTV ở tab DATA, nên công thức chiết khấu sẽ nhận ra đúng tên. Chỉ cần chọn một lần cho mỗi CTV. CTV mới sẽ tự được thêm dòng, anh chọn cột B là xong.
   - Khi anh thêm hoặc đổi tên CTV trong ô chọn của tab DATA, chạy lại **Đơn Zalo → 1. Cài đặt lần đầu** để tab CTV_Map cập nhật danh sách.
3. Quay lại Zalo Web, bấm **Xem trước** lần nữa. Các đơn của CTV đã điền tên sẽ chuyển sang 🟩.
4. Bấm **Ghi vào Sheet**. Mở tab đơn hàng và kiểm tra:
   - Đơn được ghi vào **ngay sau dòng cuối cùng** có dữ liệu.
   - Mã đơn, tổng tiền, chiết khấu tự tính đúng như khi anh nhập tay.
   - Định dạng (ngày, viền, màu) giống các dòng trên.
5. Bấm **Ghi vào Sheet** thêm lần nữa: phải báo *0 đơn đã ghi* (trùng). Như vậy là chống trùng đang chạy đúng.

> Script **chỉ ghi vào cột A (Ngày), C (Đơn Hàng) và F (Tên CTV)**, không đụng tới công thức. Bảng DATA đang có công thức sẵn đến **dòng 1228**. Khi bảng gần hết dòng, script sẽ **báo lỗi và không ghi gì**, chứ không ghi xuống phần không có công thức. Lúc đó anh kéo dài bảng và các công thức xuống thêm, rồi bấm Ghi lại.

### Bước 9: Chuyển sang Sheet thật

Khi bản sao chạy ổn:

1. Làm lại **Bước 2 → Bước 4** trên **Sheet thật**. Anh sẽ có **mã bí mật mới** và **URL mới**.
2. Chép nội dung tab **CTV_Map** từ bản sao sang tab **CTV_Map** của Sheet thật.
3. Trên Zalo Web, bấm **Xóa bộ nhớ tạm**, rồi **Cài đặt** để nhập URL và mã bí mật mới.
4. ⚠️ **Lần đầu trên Sheet thật**: chỉ cuộn qua các đơn **chưa nhập tay**. Các đơn anh đã gõ tay trước đó script không nhận ra, nên sẽ bị ghi lần nữa. Bấm **Xem trước** để kiểm tra trước khi **Ghi**.

---

## Dùng hằng ngày

1. Mở `chat.zalo.me` và vào nhóm đơn.
2. Cuộn tới đơn đầu tiên chưa ghi, bấm **▶ Bắt đầu gom**, rồi cuộn xuống tin mới nhất. Không cần chính xác: lỡ gom cả đơn cũ thì đơn đó cũng bị bỏ qua vì đã ghi rồi.
3. Bấm **⏸ Dừng gom** (không bắt buộc), rồi bấm **Ghi vào Sheet**. Nếu có đơn **Cần kiểm tra**, bảng kết quả sẽ tự hiện ra.
4. Nếu muốn chắc chắn, bấm **Xem trước** trước khi ghi. Trong bảng xem trước:
   - Mỗi đơn có một **ô tick ở cột Chọn**. Đơn nào không muốn ghi thì anh bỏ tick.
   - **Chỉ ghi từ ngày …**: chọn một ngày để bỏ tick hết các đơn trước ngày đó, ví dụ đơn hôm trước đã ghi tay rồi.
   - Bấm **Ghi các đơn đã chọn vào Sheet**. Đơn bị bỏ tick **không được ghi và lần sau cũng không hiện lại**. Nếu bỏ nhầm thì anh gõ tay đơn đó vào tab đơn hàng.

**Muốn tự động định kỳ?** Vào **Cài đặt**, ở ô số 4 nhập số phút (vd. `10`), rồi bấm **▶ Bắt đầu gom** và để nguyên tab. Script tự **ghi** các tin đã gom sau mỗi khoảng đó, với điều kiện tab Zalo Web đang mở đúng nhóm và máy Mac không ngủ. Chế độ này ghi luôn, không qua bước xem trước.

### Duyệt đơn "Cần kiểm tra"

Mở tab **Cần kiểm tra**. Mỗi dòng có cột **Lý do**, ví dụ:

| Lý do | Cách xử lý |
|---|---|
| Chưa có Tên CTV cho "…" trong tab CTV_Map | Điền cột B ở tab CTV_Map (cho lần sau), và điền cột **Tên CTV** ở dòng này |
| Không xác định được ngày | Điền cột **Ngày** |
| Không thấy SĐT, link bản đồ hoặc phí ship | Kiểm tra trên Zalo, sửa cột **Đơn Hàng** nếu cần |
| Có giá/SĐT/link nhưng không thấy dòng món | Thường là tin bổ sung cho đơn trước, hoặc CTV viết sai mẫu |

Sau khi sửa xong, tick ô **Duyệt** và chọn **Đơn Zalo → Chuyển các đơn đã duyệt**. Cột **Trạng thái** sẽ ghi "Đã chuyển". Dòng không phải đơn thì cứ để nguyên, không tick.

Sau mỗi lần ghi (từ Zalo hoặc duyệt tay), script **tự sắp xếp tab đơn hàng theo ngày**. Script chỉ đổi chỗ 3 cột Ngày / Đơn Hàng / Tên CTV, không đụng công thức. Đơn cùng ngày giữ thứ tự cũ. Vì Mã Đơn đánh theo số dòng nên Mã Đơn có thể đổi sau khi sắp xếp. Nếu anh tự gõ hay sửa đơn trong tab đơn hàng thì chọn **Đơn Zalo → Sắp xếp đơn theo ngày** để sắp lại.

### Xem nhật ký

Tab **Nhật ký** ghi mỗi lần chạy: số tin nhận, số tin trùng, số đơn đã ghi, số đơn cần kiểm tra, số tin bỏ qua, dòng đã ghi, hoặc lỗi nếu có. Chi tiết kỹ thuật xem ở Apps Script → **Lần thực thi**.

---

## Script nhận ra đơn bằng cách nào

- **Là đơn** khi tin có ít nhất một **dòng món** **và** có ít nhất một trong: **SĐT**, **link Google Maps**, hoặc chữ **Ship**.
  - Dòng món dùng **đúng quy tắc của công thức cột Tổng tiền hàng**: bắt đầu bằng số và kết thúc bằng giá có chữ **k thường**. Ví dụ `1 mì trộn bò mĩ 45k`, `1 combo 260k`.
  - Dòng như `1 cơm 40K` (K hoa) hoặc `2 trà 30.000đ` thì Sheet không tính được tiền, nên đơn đó sang **Cần kiểm tra** thay vì được ghi với tổng tiền = 0.
- **Tên CTV** phải có trong ô chọn của cột Tên CTV. Nếu không có, đơn sang Cần kiểm tra.
- **Gộp tin bổ sung**: nếu CTV gửi đơn rồi gửi tiếp SĐT, link hoặc phí ship thành tin riêng trong vòng **5 phút**, và không có ai chen vào giữa, các tin đó được gộp thành một đơn.
- **Bỏ qua**: tin không có giá, SĐT hay link (vd. "ok anh"), tin của chính anh, ảnh và sticker.
- **Không đọc được đơn gửi dạng ảnh chụp.** Những đơn đó anh vẫn phải nhập tay.

Muốn chỉnh quy tắc (vd. đổi 5 phút) thì sửa phần `CONFIG` ở đầu `Code.gs`.

## Cập nhật code

- **Apps Script**: dán code mới, Lưu, rồi vào **Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản: Phiên bản mới → Triển khai**. URL giữ nguyên. Nếu chọn "Triển khai mới" thì sẽ ra URL mới.
- **Userscript**: tự cập nhật từ GitHub, không cần làm gì. Muốn lấy bản mới ngay thì mở Tampermonkey **Dashboard**, tick ô của script, chọn **Kiểm tra cập nhật** (*Check for userscript updates*) hoặc mở lại link cài ở Bước 5, rồi tải lại trang Zalo. Cài đặt đã nhập vẫn giữ nguyên.

## Bảo mật

- Mã bí mật nằm trong **Thuộc tính tập lệnh** của Apps Script, không nằm trong code. URL và mã ở phía trình duyệt nằm trong bộ nhớ của Tampermonkey. Trong thư mục này **không có file nào chứa bí mật**, và `.gitignore` đã chặn `.env` và các file cấu hình cá nhân.
- Nếu lỡ để lộ mã: chọn **Đơn Zalo → Tạo mã bí mật mới**, rồi nhập lại trong **Cài đặt** của userscript.
- Trang Zalo là dữ liệu không tin cậy. Script chỉ hiển thị tin bằng chữ thường, không chạy nội dung tin nhắn như code.

## Giới hạn và rủi ro (đọc trước khi dùng)

- **Zalo đổi giao diện web thì script có thể đọc sai hoặc không đọc được.** Khi đó bảng Xem trước sẽ trống hoặc lạ. Làm lại phần Chẩn đoán ở Bước 7. Trong lúc chờ sửa, anh vẫn nhập tay như cũ được.
- Script chỉ thấy các tin **đã hiện trên màn hình**. Zalo chỉ giữ một đoạn tin gần đó trong trang, nên phải cuộn qua các đơn cần lấy.
- **Điều khoản Zalo**: script chỉ đọc màn hình của chính anh, không gửi yêu cầu nào tới máy chủ Zalo, nên rủi ro thấp hơn nhiều so với thư viện không chính thức như zca-js. Dù vậy, rủi ro không bằng 0 vì đây vẫn là công cụ tự động không chính thức.
- Đừng mở nhóm bằng nhiều tab Zalo Web cùng lúc khi bật tự động ghi.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Không thấy khung 📋 trên Zalo Web | Kiểm tra Tampermonkey đã bật script chưa, đã bật "Cho phép tập lệnh của người dùng" chưa (Bước 5), rồi tải lại trang |
| "Chưa mở đúng nhóm" | Vào **Cài đặt**, bấm **Lấy tên nhóm đang mở** |
| "Sai mã bí mật" | Chép lại mã từ **Đơn Zalo → Xem mã bí mật** |
| "Web App trả về không phải JSON" | URL phải kết thúc bằng `/exec`. Quyền truy cập phải là **Bất kỳ ai**. Sau khi sửa code nhớ tạo **phiên bản mới** |
| "Có nhiều tab có cột đơn hàng" | Mở đúng tab, chọn **Đơn Zalo → 2. Đặt tab đang mở làm tab ghi đơn**. Sheet chia tab theo tháng thì sang tháng mới làm lại bước này |
| Ngày bị lệch 1 ngày | Kiểm tra múi giờ dự án Apps Script (Bước 2, mục 5) |
| "chỉ có công thức đến dòng 1228" | Bảng DATA đã đầy. Kéo dài bảng và các cột công thức (B, D, E, G) xuống thêm, rồi Ghi lại |
| Đã xóa đơn ở DATA để làm lại, nhưng gom lại thì toàn báo "trùng" | Script vẫn nhớ các tin đã xử lý. Chọn **Đơn Zalo → Làm lại từ đầu**, rồi trên Zalo Web bấm **Xóa bộ nhớ tạm** và gom lại. Chỉ làm khi DATA đã xóa sạch đơn cũ |
| Đơn thật bị "Bỏ qua" | Tin chưa đúng mẫu nhận diện (xem mục "Script nhận ra đơn bằng cách nào"). Gửi mẫu tin đã che SĐT cho người hỗ trợ để chỉnh quy tắc |

## Dành cho người sửa code

- Chạy test: `./tests/run.sh`. Test dùng JavaScriptCore có sẵn trên macOS, không cần cài Node.
- Các hàm tách đơn trong `Code.gs` (`features_`, `classifyMessages_`, `judgeGroup_`) và các hàm đọc ngày trong userscript (`parseDividerDate`, `mergeSnapshot`, `maskText`) là hàm thuần, không đụng vào Sheet hay trang web, nên test trực tiếp được.
- Dữ liệu userscript gửi lên Web App có dạng `POST {token, group, dryRun, messages:[{msgId, sender, mine, date:'YYYY-MM-DD', time:'HH:mm', text}]}`. Web App trả về thống kê và `details` cho từng đơn hoặc tin.
- Khóa chống trùng là `id:<msgId>` nếu trang có mã tin. Nếu không có thì dùng `h:<SHA-256 của nhóm|người gửi|ngày|giờ|nội dung>`.
