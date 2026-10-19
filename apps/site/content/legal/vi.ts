import { sec, type Privacy, type Terms } from "../types.js";

export const privacy: Privacy = {
  seo: {
    title: "Chính sách quyền riêng tư — AutoFlow",
    description: "Cách AutoFlow xử lý dữ liệu: xử lý cục bộ, tài khoản tùy chọn, đồng bộ mã hóa đầu cuối, không quảng cáo, không cookie theo dõi và không bán dữ liệu.",
  },
  h1: "Chính sách quyền riêng tư",
  intro:
    "AutoFlow được thiết kế để chạy trên thiết bị của bạn trước tiên. Chính sách này giải thích bằng lời dễ hiểu những thông tin mà ứng dụng AutoFlow cho Windows và Android, ứng dụng web AutoFlow và trang web này xử lý, vì sao, trong bao lâu, và bạn có những quyền gì.",
  sections: {
    controller: sec(
      "1. Bên kiểm soát dữ liệu",
      "Bên kiểm soát dữ liệu cá nhân được xử lý qua AutoFlow là **ProjectTeamForYou** (“chúng tôi”). Bạn có thể liên hệ chúng tôi, bao gồm người phụ trách quyền riêng tư, qua {email}.",
    ),
    summary: sec("2. Tóm tắt", [
      "Luồng, bản ghi, hồ sơ Keyforge và nhật ký chạy được lưu và xử lý trên thiết bị của bạn.",
      "Tài khoản là tùy chọn. Nếu bạn tạo tài khoản, chúng tôi lưu email và mã băm mật khẩu.",
      "Đồng bộ được mã hóa đầu cuối. Máy chủ chỉ lưu bản mã mà chúng tôi không đọc được.",
      "Khóa AI được mã hóa trên thiết bị và chỉ gửi đến nhà cung cấp AI bạn chọn.",
      "Không quảng cáo, không cookie theo dõi, không lập hồ sơ phân tích và không bán dữ liệu cá nhân.",
    ]),
    local: sec(
      "3. Dữ liệu ở lại trên thiết bị",
      "Luồng, biến, bản ghi, ảnh chụp màn hình dùng để tìm hình ảnh, kết quả OCR, hồ sơ Keyforge, nhật ký Ledger, cài đặt và các cuộc trò chuyện với Copilot được tạo và xử lý cục bộ. Chúng không được gửi cho chúng tôi trừ khi bạn chủ động đồng bộ, đăng hoặc chia sẻ như mô tả dưới đây.",
      "Bạn có thể xóa dữ liệu này bất cứ lúc nào bằng cách xóa mục đó, xóa dữ liệu ứng dụng hoặc gỡ cài đặt.",
    ),
    account: sec(
      "4. Tài khoản tùy chọn",
      "Nếu bạn tạo tài khoản, chúng tôi xử lý:",
      ["địa chỉ email — để nhận diện tài khoản, đăng nhập và gửi thông báo thiết yếu (ví dụ đặt lại mật khẩu);", "mã băm mật khẩu tạo bằng thuật toán một chiều hiện đại có muối — chúng tôi không bao giờ lưu hay thấy mật khẩu của bạn;", "mã phiên, thời điểm tạo tài khoản và các thiết bị đã đăng nhập — để giữ an toàn cho dịch vụ."],
      "Chúng tôi chỉ dùng thông tin này để cung cấp tài khoản và đồng bộ. Chúng tôi không gửi email quảng cáo.",
    ),
    sync: sec(
      "5. Đồng bộ mã hóa đầu cuối",
      "Khi bật đồng bộ, mỗi luồng được mã hóa trên thiết bị bằng AES-GCM với khóa không bao giờ rời thiết bị của bạn ở dạng đọc được. Máy chủ chỉ lưu bản mã cùng siêu dữ liệu kỹ thuật cần cho đồng bộ: mã mục, số phiên bản, mã băm nội dung, kích thước và dấu thời gian.",
      "Chúng tôi không thể đọc, quét hay khôi phục nội dung luồng đã đồng bộ. Nếu bạn mất quyền truy cập mọi thiết bị và khóa mã hóa, dữ liệu đã mã hóa không thể khôi phục.",
    ),
    atlas: sec(
      "6. Mẫu công khai trên Atlas",
      "Khi bạn đăng mẫu lên Atlas, mẫu, phần mô tả, tên hiển thị bạn chọn và ngày đăng sẽ được công khai. Trước khi đăng, máy chủ kiểm tra mẫu, tìm lỗi và gắn nhãn rủi ro. Đánh giá và báo cáo bạn gửi được lưu cùng tài khoản để chống lạm dụng.",
      "Bạn có thể gỡ mẫu bất cứ lúc nào. Bản sao người khác đã tải về vẫn nằm trên thiết bị của họ.",
    ),
    share: sec(
      "7. Liên kết và tệp chia sẻ",
      "Liên kết chia sẻ hoặc tệp xuất chứa chính luồng đó, đã nén và mã hóa ký tự, kèm mã băm nội dung. Ai có liên kết hoặc tệp đều đọc được luồng, vì vậy đừng chia sẻ luồng chứa thông tin bí mật. Khi mở liên kết, luồng được giải mã trong trình duyệt hoặc ứng dụng của người nhận.",
    ),
    ai: sec(
      "8. Copilot và khóa AI của bạn",
      "Copilot hoạt động với nhà cung cấp AI bạn chọn (ví dụ dịch vụ tương thích OpenAI, Anthropic, hoặc mô hình cục bộ như Ollama, LM Studio). Khóa API chỉ được lưu trên thiết bị của bạn ở dạng mã hóa (khóa WebCrypto không thể xuất trong trình duyệt, Trình quản lý thông tin xác thực của Windows, Android Keystore).",
      "Câu lệnh và ngữ cảnh bạn cho phép được gửi thẳng từ thiết bị đến nhà cung cấp đó. Chúng tôi không bao giờ nhận khóa, câu lệnh hay phản hồi của bạn. Trước khi gửi, Copilot cho bạn thấy cái gì sẽ được gửi và gửi đi đâu. Dữ liệu nhà cung cấp nhận được tuân theo chính sách quyền riêng tư của họ. Ở chế độ chỉ cục bộ, mọi lệnh gọi ra ngoài đều bị chặn.",
    ),
    android: sec(
      "9. Android: công bố về dịch vụ trợ năng",
      "AutoFlow cho Android dùng API AccessibilityService vì đây là cách duy nhất Android cho phép ứng dụng chạm, vuốt và thực hiện thao tác hệ thống thay bạn. Chúng tôi dùng nó để:",
      ["thực hiện cử chỉ và thao tác hệ thống (như Quay lại, Màn hình chính) trong các luồng bạn chạy;", "chỉ đọc chữ trên màn hình khi luồng đang chạy và khi một bước bạn thêm yêu cầu (ví dụ “chờ đến khi chữ này xuất hiện”);", "nhận biết ứng dụng đang ở phía trước, chỉ để khởi động luồng có kích hoạt theo ứng dụng mà bạn đã thiết lập."],
      "Dịch vụ này **không** thu thập, lưu trữ, chia sẻ hay truyền dữ liệu cá nhân hoặc nhạy cảm, không ghi lại những gì bạn gõ, không đọc ô mật khẩu và không dùng cho quảng cáo. Dịch vụ tắt cho đến khi bạn bật, và bạn có thể tắt bất cứ lúc nào trong Cài đặt › Hỗ trợ tiếp cận. AutoFlow cũng xin quyền hiển thị trên ứng dụng khác (cho nút dừng nổi) và quyền thông báo (hiện trạng thái chạy); cả hai đều do bạn kiểm soát.",
    ),
    windows: sec(
      "10. Windows: công bố về hook nhập liệu",
      "Để cung cấp phím tắt toàn cục, đổi phím Keyforge và ghi thao tác, AutoFlow cho Windows cài hook bàn phím và chuột cấp thấp khi các tính năng này đang bật. Sự kiện nhập liệu chỉ được xử lý trong bộ nhớ máy tính để nhận diện phím tắt và phím đã đổi; chúng không được ghi lại và không bao giờ được truyền đi.",
      "Trình ghi chỉ ghi khi đang bật ghi và đèn báo ghi hiển thị. Nội dung gõ vào ô mật khẩu được che trong bản ghi.",
    ),
    website: sec(
      "11. Trang web này và ứng dụng web",
      "Chúng tôi không dùng cookie theo dõi, pixel quảng cáo hay công cụ phân tích của bên thứ ba. Trang web lưu lựa chọn giao diện và ngôn ngữ của bạn trong bộ nhớ cục bộ của trình duyệt, thông tin này không rời thiết bị. Ứng dụng web lưu luồng trong bộ nhớ trình duyệt (IndexedDB).",
      "Nhà cung cấp hosting xử lý dữ liệu kỹ thuật như địa chỉ IP, loại trình duyệt và URL được yêu cầu để phục vụ trang và chống tấn công. Các nhật ký này chỉ được lưu ngắn hạn cho mục đích bảo mật.",
    ),
    noSale: sec(
      "12. Không quảng cáo, không bán dữ liệu",
      "AutoFlow không có quảng cáo. Chúng tôi không bán, cho thuê hay chia sẻ dữ liệu cá nhân để quảng cáo theo hành vi và không lập hồ sơ về bạn.",
    ),
    processors: sec(
      "13. Bên xử lý dữ liệu",
      "Chúng tôi làm việc với một số ít nhà cung cấp xử lý dữ liệu thay mặt chúng tôi theo nghĩa vụ bảo mật và an toàn trong hợp đồng:",
      ["**Cloudflare, Inc.** — lưu trữ trang web và ứng dụng web, phân phối nội dung và chống tấn công;", "**Railway Corporation** — lưu trữ API và cơ sở dữ liệu AutoFlow (dữ liệu tài khoản, dữ liệu đồng bộ đã mã hóa, Atlas).", "Bản tải được cung cấp qua **GitHub** (Windows) và **Google Play** (Android); các dịch vụ này xử lý dữ liệu theo chính sách riêng của họ."],
    ),
    transfers: sec(
      "14. Chuyển dữ liệu ra nước ngoài",
      "Các nhà cung cấp có thể xử lý dữ liệu tại Hoa Kỳ và các quốc gia khác ngoài nơi bạn sống. Khi pháp luật yêu cầu, chúng tôi áp dụng biện pháp bảo vệ phù hợp như Điều khoản hợp đồng mẫu của Ủy ban châu Âu và Phụ lục chuyển dữ liệu quốc tế của Vương quốc Anh, đồng thời thông báo việc chuyển dữ liệu theo yêu cầu của luật Hàn Quốc và Nhật Bản. Luồng đồng bộ được mã hóa trước khi rời thiết bị của bạn.",
    ),
    retention: sec("15. Thời gian lưu trữ", [
      "Dữ liệu tài khoản: trong suốt thời gian tài khoản tồn tại.",
      "Dữ liệu đồng bộ đã mã hóa: đến khi bạn xóa mục đó hoặc tài khoản.",
      "Sau khi xóa tài khoản: gỡ khỏi hệ thống đang chạy ngay lập tức và khỏi bản sao lưu trong vòng 30 ngày.",
      "Mẫu Atlas: đến khi bạn gỡ hoặc xóa tài khoản; báo cáo lạm dụng tối đa một năm.",
      "Nhật ký bảo mật: tối đa 30 ngày, trừ khi cần lâu hơn để điều tra một sự cố cụ thể.",
    ]),
    rights: sec(
      "16. Quyền của bạn",
      "Tùy nơi bạn sống, bạn có quyền truy cập, chỉnh sửa, xóa, xuất (di chuyển) dữ liệu cá nhân, hạn chế hoặc phản đối việc xử lý, và rút lại sự đồng ý bất cứ lúc nào. Bạn có thể xuất mọi luồng từ ứng dụng và xóa tài khoản trong phần cài đặt. Với các yêu cầu khác, hãy gửi tới {email}. Chúng tôi phản hồi trong vòng 30 ngày và có thể đề nghị bạn xác minh danh tính. Việc thực hiện quyền sẽ không khiến bạn bị đối xử khác đi.",
    ),
    gdpr: sec(
      "17. Khu vực Kinh tế châu Âu và Vương quốc Anh (GDPR / UK GDPR)",
      "Chúng tôi xử lý dữ liệu tài khoản và đồng bộ để thực hiện hợp đồng với bạn (Điều 6(1)(b)), nhật ký bảo mật và chống lạm dụng dựa trên lợi ích chính đáng trong việc giữ dịch vụ an toàn (Điều 6(1)(f)), và mọi phần tùy chọn dựa trên sự đồng ý của bạn (Điều 6(1)(a)), có thể rút lại bất cứ lúc nào. Bạn có quyền khiếu nại với cơ quan bảo vệ dữ liệu tại nơi bạn sống hoặc ICO của Vương quốc Anh.",
    ),
    pipa: sec(
      "18. Hàn Quốc (PIPA)",
      "Thông tin thu thập: email và mã băm mật khẩu (bắt buộc khi tạo tài khoản), dữ liệu đồng bộ đã mã hóa và nhật ký dịch vụ. Mục đích: quản lý tài khoản, đồng bộ và bảo mật. Lưu trữ và hủy: theo mục 15; tệp điện tử được xóa không thể khôi phục. Chúng tôi không cung cấp dữ liệu cá nhân cho bên thứ ba ngoài các trường hợp nêu ở đây hoặc theo luật định; bên xử lý và chuyển dữ liệu ra nước ngoài nêu tại mục 13–14. Người phụ trách bảo vệ dữ liệu: ProjectTeamForYou, {email}.",
      "Bạn cũng có thể liên hệ Trung tâm tiếp nhận báo cáo xâm phạm thông tin cá nhân (privacy.kisa.or.kr, số 118) hoặc Ủy ban hòa giải tranh chấp thông tin cá nhân (www.kopico.go.kr, 1833-6972).",
    ),
    appi: sec(
      "19. Nhật Bản (APPI)",
      "Chúng tôi chỉ dùng thông tin cá nhân cho các mục đích nêu trong chính sách này và không cung cấp cho bên thứ ba khi chưa được đồng ý, trừ trường hợp pháp luật cho phép. Nhà cung cấp và quốc gia xử lý dữ liệu nêu tại mục 13–14. Bạn có thể yêu cầu công bố, chỉnh sửa, ngừng sử dụng hoặc xóa dữ liệu qua {email}.",
    ),
    lgpd: sec(
      "20. Brazil (LGPD)",
      "Chúng tôi xử lý dữ liệu dựa trên việc thực hiện hợp đồng, lợi ích chính đáng và sự đồng ý. Bạn có thể thực hiện các quyền theo Điều 18 LGPD — xác nhận, truy cập, chỉnh sửa, ẩn danh hóa, di chuyển, xóa, biết về việc chia sẻ và rút lại đồng ý — qua đầu mối bảo vệ dữ liệu tại {email}. Bạn cũng có thể khiếu nại với ANPD.",
    ),
    ccpa: sec(
      "21. California (CCPA / CPRA)",
      "Trong 12 tháng qua, chúng tôi đã thu thập thông tin định danh (email) và hoạt động Internet giới hạn ở nhật ký bảo mật, cho các mục đích nêu trên. Chúng tôi không bán hay chia sẻ thông tin cá nhân và không dùng thông tin nhạy cảm để suy luận đặc điểm. Bạn có quyền được biết, xóa, chỉnh sửa thông tin và không bị phân biệt đối xử khi thực hiện các quyền này. Bạn có thể ủy quyền cho đại diện; chúng tôi xác minh yêu cầu trước khi xử lý.",
    ),
    security: sec("22. Bảo mật", [
      "mã hóa TLS cho mọi lưu lượng mạng và header bảo mật nghiêm ngặt trên các trang của chúng tôi;", "mã hóa đầu cuối cho luồng đồng bộ và mã hóa khóa AI trên thiết bị;", "băm mật khẩu có muối, giới hạn tần suất truy cập và chống tấn công tự động;", "truy cập hệ thống vận hành theo nguyên tắc tối thiểu quyền và cập nhật thư viện định kỳ.",
    ], "Không hệ thống nào an toàn tuyệt đối. Nếu sự cố ảnh hưởng đến dữ liệu cá nhân của bạn, chúng tôi sẽ thông báo cho bạn và cơ quan chức năng theo quy định pháp luật."),
    children: sec(
      "23. Trẻ em",
      "AutoFlow không hướng tới trẻ em dưới 13 tuổi. Bạn phải đủ 13 tuổi để tạo tài khoản — hoặc 16 tuổi tại EEA và Vương quốc Anh (hoặc độ tuổi đồng ý kỹ thuật số thấp hơn theo luật nước bạn), 14 tuổi tại Hàn Quốc — trừ khi cha mẹ hoặc người giám hộ hợp pháp đồng ý. Nếu biết có tài khoản của trẻ em chưa có sự đồng ý cần thiết, chúng tôi sẽ xóa tài khoản đó.",
    ),
    changes: sec(
      "24. Thay đổi chính sách",
      "Mọi thay đổi sẽ được đăng trên trang này kèm ngày hiệu lực mới. Nếu thay đổi ảnh hưởng đáng kể đến cách chúng tôi dùng thông tin của bạn, chúng tôi sẽ thông báo trong ứng dụng hoặc qua email trước khi áp dụng.",
    ),
    contact: sec("25. Liên hệ", "ProjectTeamForYou · {email}"),
  },
};

export const terms: Terms = {
  seo: {
    title: "Điều khoản dịch vụ — AutoFlow",
    description: "Quy định sử dụng AutoFlow: giấy phép, sử dụng hợp lệ, trách nhiệm với tự động hóa, kết quả AI, mẫu, bảo đảm, giới hạn trách nhiệm và luật Hàn Quốc.",
  },
  h1: "Điều khoản dịch vụ",
  intro:
    "Các Điều khoản này điều chỉnh việc bạn sử dụng AutoFlow — ứng dụng Windows và Android, ứng dụng web, API AutoFlow, Atlas và trang web này (gọi chung là “Dịch vụ”). Hãy đọc kỹ; chúng được viết để dễ hiểu.",
  sections: {
    agreement: sec(
      "1. Chấp thuận",
      "Dịch vụ do **ProjectTeamForYou** (“chúng tôi”) cung cấp. Khi cài đặt, truy cập hoặc sử dụng Dịch vụ, bạn đồng ý với các Điều khoản này và Chính sách quyền riêng tư. Nếu không đồng ý, vui lòng không sử dụng Dịch vụ.",
    ),
    service: sec(
      "2. Dịch vụ",
      "AutoFlow cho phép bạn tạo, chạy thử, chạy và chia sẻ các tác vụ tự động (“luồng”) như auto click, macro, phím tắt, đổi phím và thói quen. Tính năng có thể khác nhau giữa các nền tảng. Dịch vụ miễn phí; một số tính năng tùy chọn như đồng bộ mã hóa cần tài khoản.",
    ),
    eligibility: sec(
      "3. Điều kiện và tài khoản",
      "Bạn phải đủ 13 tuổi để sử dụng Dịch vụ, hoặc lớn hơn nếu luật nước bạn yêu cầu (16 tuổi tại EEA và Vương quốc Anh, 14 tuổi tại Hàn Quốc), trừ khi cha mẹ hoặc người giám hộ hợp pháp đã đồng ý. Bạn có trách nhiệm giữ an toàn thông tin đăng nhập và khóa mã hóa, cũng như mọi hoạt động trong tài khoản.",
    ),
    license: sec(
      "4. Giấy phép",
      "Chúng tôi cấp cho bạn giấy phép cá nhân, toàn cầu, không độc quyền, không thể chuyển nhượng và có thể thu hồi để cài đặt và sử dụng Dịch vụ cho mục đích cá nhân hoặc công việc theo các Điều khoản này. Bạn không được bán, cấp phép lại, phân phối lại ứng dụng hoặc dịch ngược vượt quá mức pháp luật cho phép.",
    ),
    acceptable: sec(
      "5. Sử dụng hợp lệ",
      "Bạn không được dùng Dịch vụ để:",
      [
        "vượt qua, giải hoặc phá CAPTCHA, xác minh danh tính, xác nhận thanh toán hay các biện pháp bảo mật khác;",
        "né tránh hệ thống chống gian lận hoặc giành lợi thế không công bằng trong trò chơi cấm tự động hóa;",
        "vi phạm điều khoản dịch vụ của ứng dụng, trò chơi hay trang web bên thứ ba;",
        "gửi spam, tự động tạo tài khoản, thổi phồng lượt xem, lượt bình chọn hay chỉ số khác, hoặc lừa đảo;",
        "truy cập trái phép hệ thống hay dữ liệu, thu thập dữ liệu cá nhân khi chưa được đồng ý, hoặc phát tán mã độc;",
        "quấy rối, gây hại hoặc lừa dối người khác, hay làm bất cứ điều gì trái pháp luật;",
        "làm quá tải, tấn công hay can thiệp Dịch vụ hoặc hạ tầng, hoặc lạm dụng Atlas, báo cáo hay đánh giá.",
      ],
      "Chúng tôi có thể chặn luồng, mẫu hoặc tài khoản vi phạm các quy định này.",
    ),
    responsibility: sec(
      "6. Bạn chịu trách nhiệm về tự động hóa của mình",
      "Bạn quyết định luồng làm gì và chạy ở đâu. Bạn chịu trách nhiệm về các luồng bạn tạo, nhập, chạy và chia sẻ cùng hậu quả của chúng — bao gồm hành động trong ứng dụng bên thứ ba, giao dịch mua, tin nhắn đã gửi, dữ liệu bị thay đổi và việc tài khoản bị người khác hạn chế. Hãy thử luồng mới hoặc luồng nhập vào trên Practice Canvas, xem điểm an toàn và luôn để Halt trong tầm tay.",
    ),
    ai: sec(
      "7. Copilot và kết quả AI",
      "Copilot dùng nhà cung cấp AI do bạn chọn và cấu hình bằng khóa riêng hoặc mô hình cục bộ. Kết quả AI có thể sai, thiếu hoặc không an toàn. Bản nháp được kiểm tra và chấm điểm an toàn, nhưng bạn phải tự xem lại từng bản trước khi lưu hoặc chạy. Việc dùng nhà cung cấp tuân theo điều khoản của họ, và mọi chi phí họ thu do bạn chi trả.",
    ),
    content: sec(
      "8. Nội dung của bạn, mẫu và kiểm duyệt",
      "Bạn giữ toàn quyền với luồng và nội dung khác do bạn tạo. Khi đăng mẫu lên Atlas, bạn cấp cho chúng tôi giấy phép toàn cầu, miễn phí, không độc quyền để lưu trữ, hiển thị, định dạng lại và phân phối mẫu trong Dịch vụ khi mẫu còn được công khai, và cấp cho người dùng khác giấy phép sử dụng, sao chép, chỉnh sửa mẫu cho tự động hóa của họ.",
      "Bạn cam kết có quyền với nội dung đăng tải và nội dung đó tuân thủ các Điều khoản này. Để giữ Atlas an toàn, chúng tôi có thể xem xét, gắn nhãn, ẩn hoặc gỡ mẫu và tạm ngừng quyền đăng — ví dụ với mẫu rủi ro cao, gây hiểu nhầm, vi phạm quyền hoặc lạm dụng. Bạn có thể báo cáo nội dung trong ứng dụng hoặc qua {email}. Mẫu chính thức chỉ là ví dụ và có thể cần điều chỉnh cho môi trường của bạn.",
    ),
    sync: sec(
      "9. Đồng bộ và tính sẵn sàng",
      "Đồng bộ mã hóa là tùy chọn và hiện miễn phí trong giai đoạn ra mắt. Chúng tôi cố gắng duy trì Dịch vụ, nhưng Dịch vụ có thể gián đoạn do bảo trì, sự cố hoặc lý do ngoài tầm kiểm soát. Vì đồng bộ được mã hóa đầu cuối, chúng tôi không thể khôi phục dữ liệu nếu bạn mất khóa. Hãy lưu bản xuất của các luồng quan trọng.",
    ),
    fees: sec(
      "10. Phí",
      "Mọi thứ Dịch vụ đang cung cấp đều miễn phí. Nếu sau này có tính năng trả phí, chúng tôi sẽ thông báo trước, không áp dụng hồi tố, và tự động hóa cục bộ, Halt cùng tính năng xuất vẫn miễn phí.",
    ),
    ip: sec(
      "11. Sở hữu trí tuệ của chúng tôi",
      "Tên, logo, phần mềm, mẫu chính thức và trang web AutoFlow thuộc về ProjectTeamForYou hoặc bên cấp phép và được pháp luật bảo hộ. Các Điều khoản này không trao cho bạn quyền đối với nhãn hiệu của chúng tôi. Góp ý bạn gửi, chúng tôi có thể sử dụng mà không có nghĩa vụ với bạn.",
    ),
    thirdParty: sec(
      "12. Dịch vụ bên thứ ba",
      "Dịch vụ tương tác với các dịch vụ chúng tôi không kiểm soát như hệ điều hành, Google Play, GitHub, nhà cung cấp AI và các ứng dụng bạn tự động hóa. Việc dùng chúng tuân theo điều khoản và chính sách của từng bên, và chúng tôi không chịu trách nhiệm về chúng.",
    ),
    disclaimer: sec(
      "13. Miễn trừ bảo đảm",
      "Trong phạm vi tối đa pháp luật cho phép, Dịch vụ được cung cấp “nguyên trạng” và “tùy khả năng sẵn có”, không kèm bất kỳ bảo đảm rõ ràng hay ngụ ý nào, bao gồm khả năng thương mại, phù hợp với mục đích cụ thể và không vi phạm quyền. Chúng tôi không bảo đảm luồng chạy giống hệt nhau trên mọi thiết bị hay Dịch vụ không có lỗi. Không điều gì ở đây hạn chế quyền của người tiêu dùng mà pháp luật không cho phép loại trừ.",
    ),
    liability: sec(
      "14. Không bồi thường và giới hạn trách nhiệm pháp lý",
      "AutoFlow được cung cấp miễn phí và theo nguyên tắc “nguyên trạng”. Trong phạm vi tối đa được pháp luật cho phép, chúng tôi không bồi thường và không chịu trách nhiệm đối với bất kỳ thiệt hại nào – trực tiếp, gián tiếp, ngẫu nhiên, đặc biệt, hậu quả hoặc mang tính trừng phạt – bao gồm nhưng không giới hạn ở việc mất lợi nhuận, dữ liệu, tài khoản hoặc uy tín, phát sinh từ Dịch vụ, từ các quy trình tự động mà bạn tạo hoặc vận hành, hoặc từ các mẫu, kết quả do AI tạo ra hoặc dịch vụ của bên thứ ba. Bạn tự chịu rủi ro khi sử dụng các quy trình tự động và phải kiểm tra chúng trước khi vận hành. Quy định này không loại trừ trách nhiệm pháp lý mà theo pháp luật hiện hành không thể bị loại trừ, chẳng hạn như trách nhiệm đối với hành vi cố ý hoặc lỗi nghiêm trọng, hoặc các quyền lợi bắt buộc của người tiêu dùng.",
    ),
    indemnity: sec(
      "15. Bồi hoàn",
      "Trong phạm vi pháp luật cho phép, bạn đồng ý bồi hoàn cho chúng tôi đối với khiếu nại của bên thứ ba phát sinh từ luồng, nội dung của bạn hoặc việc bạn vi phạm các Điều khoản này.",
    ),
    termination: sec(
      "16. Chấm dứt",
      "Bạn có thể ngừng sử dụng Dịch vụ bất cứ lúc nào và xóa tài khoản trong cài đặt ứng dụng. Chúng tôi có thể tạm ngừng hoặc chấm dứt quyền truy cập nếu bạn vi phạm nghiêm trọng hoặc nhiều lần, nếu pháp luật yêu cầu, hoặc nếu chúng tôi ngừng Dịch vụ — khi đó, nếu có thể, chúng tôi sẽ báo trước trong thời gian hợp lý để bạn xuất dữ liệu. Các điều khoản về bản chất cần tiếp tục có hiệu lực sau khi chấm dứt vẫn giữ hiệu lực.",
    ),
    changes: sec(
      "17. Thay đổi Điều khoản",
      "Chúng tôi có thể cập nhật các Điều khoản này. Thay đổi sẽ được đăng trên trang này ít nhất 7 ngày trước khi có hiệu lực, hoặc ít nhất 30 ngày nếu bất lợi cho bạn, và chủ tài khoản sẽ được thông báo về thay đổi quan trọng. Nếu tiếp tục sử dụng Dịch vụ sau đó, bạn chấp nhận thay đổi; nếu không đồng ý, hãy ngừng sử dụng.",
    ),
    law: sec(
      "18. Luật áp dụng và giải quyết tranh chấp",
      "Các Điều khoản này được điều chỉnh bởi pháp luật Hàn Quốc. Mọi tranh chấp liên quan đến Dịch vụ được đưa ra Tòa án quận Trung tâm Seoul để xét xử sơ thẩm, không ảnh hưởng đến các quy định bắt buộc về bảo vệ người tiêu dùng và quyền khởi kiện tại tòa án nơi bạn cư trú nếu pháp luật cho phép. Hãy liên hệ chúng tôi trước — phần lớn vấn đề được giải quyết nhanh chóng.",
    ),
    misc: sec(
      "19. Điều khoản chung",
      "Nếu một điều khoản bị coi là không thể thực thi, các điều khoản còn lại vẫn có hiệu lực. Việc không thực thi một điều khoản không có nghĩa là từ bỏ. Bạn không được chuyển giao quyền theo Điều khoản này khi chưa có sự đồng ý của chúng tôi; chúng tôi có thể chuyển giao khi tái cơ cấu hoặc bán doanh nghiệp. Điều khoản có 12 ngôn ngữ; nếu các bản khác nhau, bản tiếng Anh được ưu tiên trừ khi luật nước bạn quy định khác.",
    ),
    contact: sec("20. Liên hệ", "ProjectTeamForYou · {email}"),
  },
};
