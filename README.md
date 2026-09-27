# 🎬 Birlikte İzle | Watch Party - Cinema for Two

Sevgilinizle veya arkadaşınızla mesafeleri sıfırlayarak, YouTube videolarını veya doğrudan video dosyalarını (.mp4, .webm) **aynı anda ve milisaniyelik senkronla** birlikte izleyebileceğiniz modern bir Watch Party web uygulaması.

---

## ✨ Öne Çıkan Özellikler

1. **Benzersiz Oda ve Davet Linki:**
   - İsminizi yazıp tek tıkla oda oluşturun.
   - Paylaşılabilir link oluşturulur (örn: `http://localhost:3000/room/ABC123`).
   - Partneriniz linke tıkladığında doğrudan odaya katılır.

2. **Tam Yetkili Host (Oda Sahibi) Kontrolü:**
   - Odayı kuran kişi (Host) videoyu seçer, başlatır, duraklatır veya ileri-geri sarar.
   - Host sayfayı yenilese bile `localStorage`'da saklanan güvenli token sayesinde yetkisini kaybetmez.
   - Partner tarafında video otomatik olarak Host ile birebir aynı saniyede oynatılır/duraklatılır.

3. **Çift Video Kaynağı Desteği:**
   - **YouTube Videoları:** YouTube IFrame API ile tam entegrasyon (`https://www.youtube.com/watch?v=...`, `youtu.be/...`, shorts veya embed linkleri).
   - **Doğrudan Video Dosyaları:** HTML5 Video Player ile `.mp4`, `.webm`, `.ogg` veya doğrudan video linkleri.
   - Sayfa üzerinde tek tıkla test edebileceğiniz hazır örnek videolar mevcuttur.

4. **Ağ Gecikmesi & Sapma Düzeltmesi (Drift Correction):**
   - Host her 2.5 saniyede bir oynatma pozisyonunu ve durumunu WebSocket üzerinden iletir.
   - Misafirin oynatıcısında 1.2 saniyeden fazla bir sapma oluşursa sistem otomatik olarak doğru saniyeye sararak (seekTo) eşitleme yapar.
   - İstendiğinde tek tıkla zorla eşitleme yapan "🔄 Eşitle" butonu bulunur.

5. **Canlı Sohbet & Canlı Emoji Tepkileri:**
   - Socket.IO üzerinden anlık, gecikmesiz sohbet paneli.
   - Host ve Misafir rozetleri, mesaj saatleri ve sistem bildirimleri.
   - Romantik ve eğlenceli yüzen emojiler (❤️, 🍿, 😂, 🥺, 🔥, 👏) — tıklandığında her iki ekranda aynı anda yükselir.

6. **Canlı Partner Durum Göstergesi:**
   - Partner henüz gelmediğinde: `Partner bekleniyor... ⏳`
   - Partner odaya katıldığında: `Partner bağlı: [İsim] 💚`

7. **Modern Sinema Tasarımı:**
   - Göz yormayan koyu sinema teması, cam efekti (glassmorphism), duyarlı (responsive) mobil uyumlu arayüz.

---

## 🚀 Kurulum ve Çalıştırma

### 1. Gereksinimler
- Bilgisayarınızda [Node.js](https://nodejs.org/) (v16 veya üstü) kurulu olmalıdır.

### 2. Kurulum
Terminali veya PowerShell'i proje klasöründe açın ve bağımlılıkları yükleyin:

```bash
npm install
```

*(Windows PowerShell'de script engeli varsa `npm.cmd install` komutunu kullanabilirsiniz.)*

### 3. Sunucuyu Başlatma

```bash
npm start
```

Veya geliştirici modunda (otomatik yeniden başlatma ile):

```bash
npm run dev
```

Sunucu başarıyla başladığında terminalde şu çıktıyı göreceksiniz:
```
===============================================
🎬 Dizi/Film Watch Party Sunucusu Çalışıyor!
🚀 Adres: http://localhost:3000
===============================================
```

### 4. Tarayıcıda Açma
Tarayıcınızda [http://localhost:3000](http://localhost:3000) adresine gidin.

---

## 🌐 Farklı Konumlardaki Partnerinizle İnternet Üzerinden İzleme

Eğer partneriniz farklı bir evde/şehirse, sitenizi internete açmanın en kolay yolları:

### Seçenek A: Ücretsiz Geçici Tünel (Localtunnel veya Ngrok)
Sunucunuz çalışırken yeni bir terminal sekmesi açıp:

```bash
npx localtunnel --port 3000
```
veya
```bash
npx ngrok http 3000
```
Size verilen genel linki (örn: `https://tatli-sinema.loca.lt`) sevgilinize gönderebilirsiniz.

### Seçenek B: Ücretsiz Bulut Dağıtımı (Render / Railway / Glitch)
- Projeyi GitHub'a yükleyip [Render.com](https://render.com) veya [Railway.app](https://railway.app)'e ücretsiz Node.js Web Service olarak 1 dakikada deploy edebilirsiniz.

---

## 📁 Dosya Yapısı

```
├── server.js              # Express & Socket.IO sunucusu, oda ve senkron yönetimi
├── package.json           # Proje bağımlılıkları ve komutları
├── test-sync.js           # Çoklu istemci senkronizasyon otomatik testi
├── public/
│   ├── index.html         # Tek sayfa uygulaması (Giriş & Oda arayüzü)
│   ├── style.css          # Modern sinema teması ve animasyonlar
│   └── app.js             # İstemci WebSocket, YouTube API, HTML5 oynatıcı ve sohbet
└── README.md              # Kullanım ve kurulum kılavuzu
```

İyi seyirler! 🍿❤️
