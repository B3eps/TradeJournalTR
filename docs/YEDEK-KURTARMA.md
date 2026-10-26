# Trade Günlüğü yedek ve kurtarma

Paketli Windows uygulamasının veri yolu `%APPDATA%\trade-gunlugu\data\` klasörüdür. Geliştirme ortamında yol `DATA_DIR` ayarıyla değişebilir.

## Yedek türü

Bağlantılar > Yedekleme bölümünde oluşturulan yeni yerel yedekler, tutarlı bir SQLite veritabanı kopyasını, `screenshots/` dosyalarını ve `news-eval/` haber değerlendirmelerini içerir. Klasörün `manifest.json` dosyası kayıt sayılarını, görsel ve değerlendirme sayılarını ve şifreleme anahtarının parmak izini tutar. Eski yedekler yalnız veritabanını içerir.

`secret.key` ve ortam değişkeni olarak verilmiş `ENCRYPTION_KEY` yedeğe eklenmez. Yedek klasörü başka bir yere eşitlenebilir veya paylaşılabilir; anahtarın da orada bulunması broker ve bağlantı sırlarını açığa çıkarır. Anahtarın ayrı, güvenli bir kopyası olmadan yeni bilgisayarda şifreli bağlantılar çözülemez. Uygulama arayüzü yeni yedeklerde anahtar uyumunu gösterir.

## Aynı bilgisayarda geri yükleme

1. Uygulamadan sistem tepsisi dahil tamamen çıkın.
2. Mevcut `data/` klasörünün tamamını güvenli bir yere kopyalayın. Bu kopya geri dönüş yolunuzdur.
3. `rrmetrics.db`, `rrmetrics.db-wal` ve `rrmetrics.db-shm` dosyalarını `data/` dışına taşıyın. Eski WAL dosyasını yeni veritabanıyla bırakmayın.
4. Seçilen yedekteki `rrmetrics.db` dosyasını `data/` içine kopyalayın.
5. Yedekte varsa `screenshots/` ve `news-eval/` içindeki dosyaları karşılık gelen `data/` alt klasörlerine kopyalayın. Var olan dosyaları topluca silmeyin.
6. `secret.key` dosyasını değiştirmeyin. `ENCRYPTION_KEY` kullanılıyorsa aynı değeri koruyun.
7. Uygulamayı açıp işlemleri, ekleri ve bağlantıları kontrol edin. Sorun olursa uygulamadan çıkıp 2. adımdaki tam klasör kopyasına dönün.

## Başka bilgisayara taşıma

Uygulama kapalıyken **tüm `data/` klasörünü** güvenli bir aktarım yoluyla yeni bilgisayara kopyalayın. Bu klasör `secret.key` dosyasını ve ekran görüntülerini de içerir; sır gibi koruyun. Eski kurulum `ENCRYPTION_KEY` ortam değişkeni kullandıysa yeni kurulumda aynı değeri ayrıca ayarlayın. Yeni bilgisayarda uygulamanın oluşturduğu boş `data/` klasörünü koruyup üzerine parça parça kopyalamayın; önce boş klasörü ayrı yere taşıyın, sonra tam kopyayı yerleştirin. İlk açılışta işlem ve ekleri doğrulayın.

Yerel yedekler tek başına yeni bilgisayara taşınabilir tam paket değildir. `secret.key` kaybolduysa eski şifreli broker ve entegrasyon sırları bu yedekten kurtarılamaz; ilgili bağlantıların yeniden kurulması gerekir.
