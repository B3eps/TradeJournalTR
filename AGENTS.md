# Trade Günlüğü çalışma notu

Bu proje, RR Metrics tabanlı yerel bir işlem günlüğünü görevler, haberler, notlar, öğrenme, zaman takibi ve finans araçlarıyla birleştirir. Ana uygulama React istemcisi, Hono/TypeScript sunucusu, SQLite veritabanı ve Electron kabuğundan oluşur.

## Geliştirme

- `npm run build`: istemciyi `public/assets/` altına derler.
- `npx tsc --noEmit -p server/tsconfig.json`: sunucu tiplerini denetler.
- `npm start`: geliştirme sunucusunu başlatır; varsayılan port için `server/src/config.ts` dosyasına bakın.
- `npm run bundle`: Electron'ın kullandığı `electron/server.cjs` dosyasını üretir.
- `npm run dist`: taşınabilir Windows uygulamasını paketler.

Uygulama verisi (`data/`, `%APPDATA%/trade-gunlugu/data/`), ekran görüntüleri, veritabanı ve şifreleme anahtarları kullanıcıya aittir. Bu dosyaları silmeyin, kaynak yedekleriyle karıştırmayın ve raporlara kimlik bilgisi yazmayın. Paketli uygulama güncellemeleri için kökteki `guncelle.bat` ve `PROJE-NOTLARI.md` dosyalarına bakın. `CLAUDE.md` eski RR Metrics tabanına ait tarihsel bilgi içerir; güncel davranışı koddan doğrulayın.

Haber değerlendirme istemi herhangi bir yapay zeka aracına yapıştırılabilir. Uygulama, değerlendirme dosyalarını `server/src/services/newsfeed/evaluation.ts` içindeki doğrulama ve filtreleme kurallarından geçirir. Finansal işlem emri veya fiyat seviyesi öneren içerik üretmeyin.
