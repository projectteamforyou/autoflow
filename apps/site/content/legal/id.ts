import { sec, type Privacy, type Terms } from "../types.js";

export const privacy: Privacy = {
  seo: {
    title: "Kebijakan Privasi — AutoFlow",
    description: "Cara AutoFlow menangani data Anda: pemrosesan lokal, akun opsional, sinkronisasi terenkripsi end-to-end, tanpa iklan, pelacak, atau jual data.",
  },
  h1: "Kebijakan Privasi",
  intro:
    "AutoFlow dirancang untuk bekerja di perangkat Anda terlebih dulu. Kebijakan ini menjelaskan dengan bahasa sederhana informasi apa yang diproses oleh aplikasi AutoFlow untuk Windows dan Android, aplikasi web AutoFlow, dan situs ini, mengapa, berapa lama, serta hak-hak Anda.",
  sections: {
    controller: sec(
      "1. Pengendali data",
      "Pengendali data pribadi yang diproses melalui AutoFlow adalah **ProjectTeamForYou** (“kami”). Anda dapat menghubungi kami, termasuk petugas privasi kami, di {email}.",
    ),
    summary: sec("2. Ringkasan", [
      "Alur, rekaman, profil Keyforge, dan log eksekusi disimpan dan diproses di perangkat Anda.",
      "Akun bersifat opsional. Jika Anda membuatnya, kami menyimpan email dan hash kata sandi Anda.",
      "Sinkronisasi dienkripsi end-to-end. Server kami hanya menyimpan ciphertext yang tak bisa kami baca.",
      "Kunci AI tetap terenkripsi di perangkat Anda dan hanya dikirim ke penyedia AI yang Anda pilih.",
      "Tanpa iklan, tanpa cookie pelacak, tanpa profil analitik, dan tanpa penjualan data pribadi.",
    ]),
    local: sec(
      "3. Data yang tetap di perangkat Anda",
      "Alur, variabel, rekaman, tangkapan layar untuk pencarian gambar, hasil OCR, profil Keyforge, log Ledger, setelan, dan percakapan Copilot dibuat dan diproses secara lokal. Data ini tidak dikirim ke kami kecuali Anda secara tegas menyinkronkan, menerbitkan, atau membagikannya seperti dijelaskan di bawah.",
      "Anda dapat menghapus data ini kapan saja dengan menghapus itemnya, membersihkan data aplikasi, atau mencopot pemasangan aplikasi.",
    ),
    account: sec(
      "4. Akun opsional",
      "Jika Anda membuat akun, kami memproses:",
      ["alamat email Anda, untuk mengenali akun, masuk, dan mengirim pesan layanan penting (misalnya atur ulang kata sandi);", "hash kata sandi yang dibuat dengan algoritme satu arah modern bergaram — kami tidak pernah menyimpan atau melihat kata sandi Anda;", "token sesi, waktu pembuatan akun, dan perangkat yang masuk, untuk menjaga keamanan layanan."],
      "Informasi ini hanya kami gunakan untuk menyediakan akun dan sinkronisasi. Kami tidak mengirim email pemasaran.",
    ),
    sync: sec(
      "5. Sinkronisasi terenkripsi end-to-end",
      "Saat sinkronisasi aktif, setiap alur dienkripsi di perangkat Anda dengan AES-GCM menggunakan kunci yang tak pernah meninggalkan perangkat Anda dalam bentuk terbaca. Server hanya menyimpan ciphertext dan metadata teknis yang diperlukan: ID item, nomor revisi, hash isi, ukuran, dan stempel waktu.",
      "Kami tidak dapat membaca, memindai, atau memulihkan isi alur yang disinkronkan. Jika Anda kehilangan akses ke semua perangkat dan kunci enkripsi, data terenkripsi tidak dapat dipulihkan.",
    ),
    atlas: sec(
      "6. Templat publik Atlas",
      "Jika Anda menerbitkan templat ke Atlas, templat, deskripsinya, nama tampilan pilihan Anda, dan tanggal terbit menjadi publik. Sebelum terbit, server memvalidasi templat, memeriksa error, dan memberi label risiko. Penilaian dan laporan yang Anda kirim disimpan bersama akun untuk mencegah penyalahgunaan.",
      "Anda dapat membatalkan penerbitan kapan saja. Salinan yang sudah diunduh orang lain tetap ada di perangkat mereka.",
    ),
    share: sec(
      "7. Tautan dan file berbagi",
      "Tautan berbagi atau file ekspor berisi alur itu sendiri, dikompresi dan dienkode, beserta hash isinya. Siapa pun yang memegang tautan atau file dapat membaca alurnya, jadi jangan bagikan alur yang berisi rahasia. Saat tautan dibuka, alur didekode di browser atau aplikasi penerima.",
    ),
    ai: sec(
      "8. Copilot dan kunci AI Anda",
      "Copilot bekerja dengan penyedia AI pilihan Anda (misalnya layanan kompatibel OpenAI, Anthropic, atau model lokal seperti Ollama atau LM Studio). Kunci API Anda hanya disimpan di perangkat dalam keadaan terenkripsi (kunci WebCrypto yang tak dapat diekspor di browser, Credential Manager Windows, Android Keystore).",
      "Perintah dan konteks yang Anda setujui dikirim langsung dari perangkat ke penyedia tersebut. Kami tidak pernah menerima kunci, perintah, maupun jawaban Anda. Sebelum mengirim, Copilot menunjukkan apa yang akan dikirim dan ke mana. Data yang diterima penyedia tunduk pada kebijakan privasinya sendiri. Dalam mode lokal saja, panggilan keluar diblokir.",
    ),
    android: sec(
      "9. Android: pengungkapan layanan aksesibilitas",
      "AutoFlow untuk Android memakai API AccessibilityService karena hanya dengan cara ini Android mengizinkan aplikasi mengetuk, menggeser, dan melakukan aksi global atas nama Anda. Kami menggunakannya untuk:",
      ["menjalankan gestur dan aksi global (seperti Kembali atau Beranda) dalam alur yang Anda jalankan;", "membaca teks di layar hanya saat alur berjalan dan hanya bila langkah yang Anda tambahkan memerlukannya (misalnya “tunggu sampai teks ini muncul”);", "mengenali aplikasi yang sedang di depan, hanya untuk memulai alur dengan pemicu per aplikasi yang Anda atur."],
      "Layanan ini **tidak** mengumpulkan, menyimpan, membagikan, atau mengirim data pribadi maupun sensitif, tidak merekam ketikan, tidak membaca kolom kata sandi, dan tidak dipakai untuk iklan. Layanan nonaktif sampai Anda menyalakannya, dan dapat dimatikan kapan saja di Setelan › Aksesibilitas. AutoFlow juga meminta izin tampil di atas aplikasi lain (untuk tombol berhenti melayang) dan izin notifikasi (untuk status eksekusi); keduanya Anda kendalikan.",
    ),
    windows: sec(
      "10. Windows: pengungkapan hook input",
      "Untuk menyediakan pintasan global, remap Keyforge, dan perekam, AutoFlow untuk Windows memasang hook keyboard dan mouse tingkat rendah selama fitur tersebut aktif. Peristiwa input diproses di memori PC Anda untuk mengenali pintasan dan remap; tidak dicatat dan tidak pernah dikirim.",
      "Perekam hanya merekam input saat perekaman aktif dan indikatornya terlihat. Teks yang diketik di kolom kata sandi disamarkan dalam rekaman.",
    ),
    website: sec(
      "11. Situs ini dan aplikasi web",
      "Kami tidak memakai cookie pelacak, piksel iklan, atau analitik pihak ketiga. Situs menyimpan pilihan tema dan bahasa Anda di penyimpanan lokal browser, yang tak pernah keluar dari perangkat. Aplikasi web menyimpan alur Anda di penyimpanan browser (IndexedDB).",
      "Penyedia hosting kami memproses data teknis seperti alamat IP, jenis browser, dan URL yang diminta untuk menayangkan halaman dan melindunginya dari serangan. Log ini disimpan singkat dan hanya untuk keamanan.",
    ),
    noSale: sec(
      "12. Tanpa iklan, tanpa jual data",
      "AutoFlow tidak berisi iklan. Kami tidak menjual, menyewakan, atau membagikan data pribadi untuk iklan berbasis perilaku, dan kami tidak membuat profil tentang Anda.",
    ),
    processors: sec(
      "13. Pemroses data",
      "Kami bekerja dengan sedikit penyedia yang memproses data atas nama kami dengan kewajiban kerahasiaan dan keamanan dalam kontrak:",
      ["**Cloudflare, Inc.** — hosting situs dan aplikasi web, pengiriman konten, dan perlindungan serangan;", "**Railway Corporation** — hosting API dan basis data AutoFlow (data akun, data sinkronisasi terenkripsi, Atlas).", "Unduhan disediakan melalui **GitHub** (Windows) dan **Google Play** (Android), yang memproses data Anda sesuai kebijakan privasi masing-masing."],
    ),
    transfers: sec(
      "14. Transfer internasional",
      "Penyedia kami dapat memproses data di Amerika Serikat dan negara lain di luar negara Anda. Bila diwajibkan hukum, kami menerapkan perlindungan yang memadai seperti Klausul Kontrak Standar Komisi Eropa dan Adendum Transfer Data Internasional Inggris, serta memberi tahu transfer sebagaimana disyaratkan hukum Korea dan Jepang. Alur yang disinkronkan sudah terenkripsi sebelum meninggalkan perangkat Anda.",
    ),
    retention: sec("15. Lama penyimpanan", [
      "Data akun: selama akun ada.",
      "Data sinkronisasi terenkripsi: sampai Anda menghapus item atau akun.",
      "Setelah akun dihapus: segera dihapus dari sistem aktif dan dari cadangan dalam 30 hari.",
      "Templat Atlas: sampai dibatalkan penerbitannya atau akun dihapus; laporan penyalahgunaan hingga satu tahun.",
      "Log keamanan: hingga 30 hari, kecuali diperlukan lebih lama untuk menyelidiki insiden tertentu.",
    ]),
    rights: sec(
      "16. Hak Anda",
      "Tergantung tempat tinggal Anda, Anda berhak mengakses, memperbaiki, menghapus, dan mengekspor (portabilitas) data pribadi, membatasi atau menolak pemrosesan, serta menarik persetujuan kapan saja. Anda dapat mengekspor semua alur dari aplikasi kapan pun dan menghapus akun di setelan. Untuk permintaan lain, kirim email ke {email}. Kami menjawab dalam 30 hari dan dapat meminta Anda memverifikasi identitas. Menggunakan hak Anda tidak akan membuat Anda diperlakukan berbeda.",
    ),
    gdpr: sec(
      "17. Kawasan Ekonomi Eropa dan Inggris (GDPR / UK GDPR)",
      "Kami memproses data akun dan sinkronisasi untuk melaksanakan kontrak dengan Anda (Pasal 6(1)(b)), log keamanan dan pencegahan penyalahgunaan berdasarkan kepentingan sah kami menjaga layanan tetap aman (Pasal 6(1)(f)), dan fitur opsional berdasarkan persetujuan Anda (Pasal 6(1)(a)), yang dapat ditarik kapan saja. Anda berhak mengadu ke otoritas perlindungan data setempat atau ICO di Inggris.",
    ),
    pipa: sec(
      "18. Republik Korea (PIPA)",
      "Data yang dikumpulkan: email dan hash kata sandi (wajib untuk akun), data sinkronisasi terenkripsi, dan log layanan. Tujuan: pengelolaan akun, sinkronisasi, dan keamanan. Penyimpanan dan pemusnahan: sesuai bagian 15; file elektronik dihapus tanpa bisa dipulihkan. Kami tidak memberikan data pribadi kepada pihak ketiga kecuali seperti dijelaskan di sini atau diwajibkan hukum; pemroses dan transfer ke luar negeri ada di bagian 13–14. Petugas perlindungan data: ProjectTeamForYou, {email}.",
      "Anda juga dapat menghubungi Pusat Pengaduan Pelanggaran Informasi Pribadi (privacy.kisa.or.kr, telepon 118) atau Komite Mediasi Sengketa Informasi Pribadi (www.kopico.go.kr, 1833-6972).",
    ),
    appi: sec(
      "19. Jepang (APPI)",
      "Kami hanya menggunakan informasi pribadi untuk tujuan dalam kebijakan ini dan tidak memberikannya kepada pihak ketiga tanpa persetujuan kecuali diizinkan hukum. Penyedia dan negara tempat data diproses tercantum di bagian 13–14. Anda dapat meminta pengungkapan, perbaikan, penghentian penggunaan, atau penghapusan data melalui {email}.",
    ),
    lgpd: sec(
      "20. Brasil (LGPD)",
      "Kami memproses data berdasarkan pelaksanaan kontrak, kepentingan sah, dan persetujuan. Anda dapat menggunakan hak berdasarkan Pasal 18 LGPD — konfirmasi, akses, perbaikan, anonimisasi, portabilitas, penghapusan, informasi tentang pembagian, dan penarikan persetujuan — melalui kontak perlindungan data kami di {email}. Anda juga dapat mengadu ke ANPD.",
    ),
    ccpa: sec(
      "21. California (CCPA / CPRA)",
      "Dalam 12 bulan terakhir kami mengumpulkan pengenal (alamat email) dan aktivitas internet yang terbatas pada log keamanan, untuk tujuan bisnis di atas. Kami tidak menjual atau membagikan informasi pribadi dan tidak memakai informasi sensitif untuk menyimpulkan karakteristik. Anda berhak mengetahui, menghapus, dan memperbaiki informasi Anda serta tidak didiskriminasi karena menggunakan hak tersebut. Anda dapat memakai agen resmi; kami memverifikasi permintaan sebelum menindaklanjutinya.",
    ),
    security: sec("22. Keamanan", [
      "enkripsi TLS untuk semua lalu lintas jaringan dan header keamanan ketat di situs kami;", "enkripsi end-to-end untuk alur yang disinkronkan dan enkripsi kunci AI di perangkat;", "hash kata sandi bergaram, pembatasan laju permintaan, dan perlindungan dari serangan otomatis;", "akses hak minimum ke sistem produksi dan pembaruan dependensi secara berkala.",
    ], "Tidak ada sistem yang sepenuhnya aman. Jika terjadi insiden yang memengaruhi data pribadi Anda, kami akan memberi tahu Anda dan otoritas sesuai hukum."),
    children: sec(
      "23. Anak-anak",
      "AutoFlow tidak ditujukan untuk anak di bawah 13 tahun. Anda harus berusia minimal 13 tahun untuk membuat akun — atau 16 tahun di EEA dan Inggris (atau usia persetujuan digital yang lebih rendah di negara Anda) dan 14 tahun di Korea — kecuali orang tua atau wali sah menyetujui. Jika kami mengetahui ada akun anak tanpa persetujuan yang diperlukan, kami akan menghapusnya.",
    ),
    changes: sec(
      "24. Perubahan kebijakan",
      "Setiap perubahan akan dipublikasikan di halaman ini dengan tanggal berlaku yang baru. Jika perubahan berdampak besar pada cara kami menggunakan informasi Anda, kami akan mengumumkannya di aplikasi atau lewat email sebelum berlaku.",
    ),
    contact: sec("25. Kontak", "ProjectTeamForYou · {email}"),
  },
};

export const terms: Terms = {
  seo: {
    title: "Ketentuan Layanan — AutoFlow",
    description: "Aturan AutoFlow: lisensi, penggunaan yang diizinkan, tanggung jawab atas otomatisasi, hasil AI, templat, jaminan, batas tanggung jawab, hukum Korea.",
  },
  h1: "Ketentuan Layanan",
  intro:
    "Ketentuan ini mengatur penggunaan AutoFlow — aplikasi Windows dan Android, aplikasi web, API AutoFlow, Atlas, dan situs ini (bersama-sama disebut “Layanan”). Mohon dibaca; ketentuan ini ditulis agar mudah dipahami.",
  sections: {
    agreement: sec(
      "1. Persetujuan",
      "Layanan disediakan oleh **ProjectTeamForYou** (“kami”). Dengan memasang, mengakses, atau menggunakan Layanan, Anda menyetujui Ketentuan ini dan Kebijakan Privasi kami. Jika tidak setuju, jangan gunakan Layanan.",
    ),
    service: sec(
      "2. Layanan",
      "AutoFlow memungkinkan Anda membuat, melatih, menjalankan, dan membagikan otomatisasi (“alur”) seperti klik otomatis, makro, pintasan, remap tombol, dan rutinitas. Fitur dapat berbeda di tiap platform. Layanan ini gratis; fitur opsional seperti sinkronisasi terenkripsi memerlukan akun.",
    ),
    eligibility: sec(
      "3. Syarat dan akun",
      "Anda harus berusia minimal 13 tahun untuk memakai Layanan, atau lebih jika hukum negara Anda mensyaratkan (16 tahun di EEA dan Inggris, 14 tahun di Korea), kecuali orang tua atau wali sah telah menyetujui. Anda bertanggung jawab menjaga kredensial masuk dan kunci enkripsi serta atas aktivitas di akun Anda.",
    ),
    license: sec(
      "4. Lisensi",
      "Kami memberi Anda lisensi pribadi, berlaku di seluruh dunia, noneksklusif, tidak dapat dialihkan, dan dapat dicabut untuk memasang dan memakai Layanan bagi keperluan pribadi maupun bisnis sesuai Ketentuan ini. Anda tidak boleh menjual, mensublisensikan, mendistribusikan ulang aplikasi, atau merekayasa baliknya melebihi yang diizinkan hukum.",
    ),
    acceptable: sec(
      "5. Penggunaan yang diizinkan",
      "Anda tidak boleh memakai Layanan untuk:",
      [
        "melewati, memecahkan, atau mengalahkan CAPTCHA, verifikasi identitas, konfirmasi pembayaran, atau langkah keamanan lain;",
        "menghindari sistem anti-cheat atau memperoleh keuntungan tidak adil di game yang melarang otomatisasi;",
        "melanggar ketentuan layanan aplikasi, game, atau situs pihak ketiga;",
        "mengirim spam, membuat akun otomatis, menggelembungkan tayangan, suara, atau metrik lain, atau melakukan penipuan;",
        "mengakses sistem atau data tanpa izin, mengumpulkan data pribadi tanpa persetujuan, atau menyebarkan malware;",
        "melecehkan, merugikan, atau menipu orang lain, atau melakukan hal yang melanggar hukum;",
        "membebani, menyerang, atau mengganggu Layanan dan infrastrukturnya, atau menyalahgunakan Atlas, laporan, atau penilaian.",
      ],
      "Kami dapat memblokir alur, templat, atau akun yang melanggar aturan ini.",
    ),
    responsibility: sec(
      "6. Anda bertanggung jawab atas otomatisasi Anda",
      "Andalah yang menentukan apa yang dilakukan alur dan di mana alur berjalan. Anda bertanggung jawab atas alur yang Anda buat, impor, jalankan, dan bagikan beserta akibatnya — termasuk tindakan di aplikasi pihak ketiga, pembelian, pesan yang terkirim, data yang berubah, dan pembatasan akun oleh pihak lain. Uji alur baru atau hasil impor di Practice Canvas, periksa nilai keamanannya, dan selalu siapkan Halt.",
    ),
    ai: sec(
      "7. Copilot dan hasil AI",
      "Copilot memakai penyedia AI yang Anda pilih dan atur dengan kunci sendiri atau model lokal. Hasil AI bisa salah, tidak lengkap, atau tidak aman. Draf divalidasi dan dinilai, tetapi Anda wajib meninjau setiap draf sebelum menyimpan atau menjalankannya. Penggunaan penyedia tunduk pada ketentuannya, dan biaya yang dikenakannya menjadi tanggungan Anda.",
    ),
    content: sec(
      "8. Konten Anda, templat, dan moderasi",
      "Anda tetap memegang semua hak atas alur dan konten lain yang Anda buat. Saat menerbitkan templat ke Atlas, Anda memberi kami lisensi global, bebas royalti, dan noneksklusif untuk meng-hosting, menyimpan, menampilkan, memformat, dan mendistribusikannya di dalam Layanan selama templat itu terbit, serta memberi pengguna lain lisensi untuk memakai, menyalin, dan mengubahnya bagi otomatisasi mereka.",
      "Anda menjamin memiliki hak atas yang Anda terbitkan dan bahwa konten tersebut mematuhi Ketentuan ini. Demi menjaga Atlas tetap aman, kami dapat meninjau, melabeli, menyembunyikan, atau menghapus templat serta menangguhkan hak menerbitkan — misalnya untuk templat berisiko tinggi, menyesatkan, melanggar hak, atau menyalahgunakan. Anda dapat melaporkan konten lewat aplikasi atau {email}. Templat resmi disediakan sebagai contoh dan mungkin perlu disesuaikan dengan lingkungan Anda.",
    ),
    sync: sec(
      "9. Sinkronisasi dan ketersediaan",
      "Sinkronisasi terenkripsi bersifat opsional dan saat ini gratis selama peluncuran. Kami berupaya menjaga Layanan tetap tersedia, tetapi Layanan dapat terganggu karena pemeliharaan, kegagalan, atau hal di luar kendali kami. Karena sinkronisasi dienkripsi end-to-end, kami tak dapat memulihkan data jika Anda kehilangan kunci. Simpan ekspor alur yang penting bagi Anda.",
    ),
    fees: sec(
      "10. Biaya",
      "Semua yang ditawarkan Layanan saat ini gratis. Jika kelak kami memperkenalkan fitur berbayar, kami akan mengumumkannya lebih dulu, tidak berlaku surut, dan otomatisasi lokal, Halt, serta ekspor tetap gratis.",
    ),
    ip: sec(
      "11. Kekayaan intelektual kami",
      "Nama, logo, perangkat lunak, templat resmi, dan situs AutoFlow dimiliki ProjectTeamForYou atau pemberi lisensinya dan dilindungi hukum. Ketentuan ini tidak memberi Anda hak atas merek dagang kami. Masukan yang Anda kirim boleh kami gunakan tanpa kewajiban kepada Anda.",
    ),
    thirdParty: sec(
      "12. Layanan pihak ketiga",
      "Layanan berinteraksi dengan layanan yang tidak kami kendalikan, seperti sistem operasi, Google Play, GitHub, penyedia AI, dan aplikasi yang Anda otomatiskan. Penggunaannya tunduk pada ketentuan dan kebijakan masing-masing, dan kami tidak bertanggung jawab atasnya.",
    ),
    disclaimer: sec(
      "13. Penafian jaminan",
      "Sejauh diizinkan hukum, Layanan disediakan “sebagaimana adanya” dan “sebagaimana tersedia”, tanpa jaminan apa pun, tersurat maupun tersirat, termasuk kelayakan jual, kesesuaian untuk tujuan tertentu, dan tidak melanggar hak. Kami tidak menjamin alur berperilaku sama di setiap perangkat atau Layanan bebas error. Tidak ada ketentuan di sini yang membatasi hak Anda sebagai konsumen yang tidak dapat dikecualikan oleh hukum.",
    ),
    liability: sec(
      "14. Tidak Ada Kompensasi dan Pembatasan Tanggung Jawab",
      "AutoFlow disediakan secara gratis dan \"sebagaimana adanya\". Sepanjang diizinkan oleh hukum yang berlaku, kami tidak memberikan kompensasi dan tidak bertanggung jawab atas segala kerugian—baik langsung, tidak langsung, insidental, khusus, konsekuensial, maupun hukuman—termasuk namun tidak terbatas pada hilangnya keuntungan, data, akun, atau itikad baik, yang timbul dari penggunaan Layanan, dari otomatisasi yang Anda buat atau jalankan, maupun dari templat, keluaran AI, atau layanan pihak ketiga. Anda menggunakan otomatisasi atas risiko Anda sendiri dan wajib memeriksa otomatisasi tersebut sebelum menjalankannya. Ketentuan ini tidak mengecualikan tanggung jawab yang tidak dapat dikecualikan berdasarkan hukum yang berlaku, seperti tanggung jawab atas kesengajaan atau kelalaian berat, atau hak-hak konsumen yang bersifat wajib.",
    ),
    indemnity: sec(
      "15. Ganti rugi",
      "Sejauh diizinkan hukum, Anda setuju mengganti kerugian kami atas klaim pihak ketiga yang timbul dari alur, konten Anda, atau pelanggaran Anda terhadap Ketentuan ini.",
    ),
    termination: sec(
      "16. Pengakhiran",
      "Anda dapat berhenti memakai Layanan kapan saja dan menghapus akun di setelan aplikasi. Kami dapat menangguhkan atau mengakhiri akses jika Anda melanggar Ketentuan ini secara serius atau berulang, jika diwajibkan hukum, atau jika kami menghentikan Layanan — dalam hal ini kami akan memberi pemberitahuan wajar bila memungkinkan agar Anda dapat mengekspor data. Ketentuan yang menurut sifatnya harus tetap berlaku akan tetap berlaku.",
    ),
    changes: sec(
      "17. Perubahan Ketentuan",
      "Kami dapat memperbarui Ketentuan ini. Perubahan dipublikasikan di halaman ini paling lambat 7 hari sebelum berlaku, atau 30 hari sebelumnya jika merugikan Anda, dan pemilik akun akan diberi tahu tentang perubahan penting. Jika Anda tetap memakai Layanan setelah perubahan berlaku, Anda dianggap menerimanya; jika tidak setuju, berhentilah memakai Layanan.",
    ),
    law: sec(
      "18. Hukum yang berlaku dan sengketa",
      "Ketentuan ini diatur oleh hukum Republik Korea. Setiap sengketa terkait Layanan diajukan ke Pengadilan Distrik Pusat Seoul sebagai pengadilan tingkat pertama, tanpa mengurangi aturan wajib perlindungan konsumen dan hak Anda mengajukan perkara di pengadilan negara tempat tinggal Anda bila hukum memberikannya. Hubungi kami lebih dulu — sebagian besar masalah dapat diselesaikan dengan cepat.",
    ),
    misc: sec(
      "19. Lain-lain",
      "Jika suatu ketentuan dinyatakan tidak berlaku, ketentuan lainnya tetap berlaku. Tidak menegakkan suatu ketentuan bukan berarti melepaskannya. Anda tidak boleh mengalihkan hak berdasarkan Ketentuan ini tanpa persetujuan kami; kami dapat mengalihkannya dalam reorganisasi atau penjualan. Ketentuan ini tersedia dalam 12 bahasa; jika terdapat perbedaan, versi bahasa Inggris yang berlaku kecuali hukum negara Anda menentukan lain.",
    ),
    contact: sec("20. Kontak", "ProjectTeamForYou · {email}"),
  },
};
