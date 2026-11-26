# MuTerminal Core · Aşama 1 (0–3 ay)

İlk MVP’nin hedefi bir FİLE Market pilot mağazasında ürün ve lot bazında kontrol, gerekçeli manuel karar, yönetici onayı ve otomatik dijital kayıt akışını doğrulamaktır. Pilot altı temel modülü kapsar. Eski kayıtlar Pilot Mağaza altında görünür.

**Pilot iş akışı**

Barkodla ürün kontrolü → Gerekçeli manuel karar → Yönetici onayı → Otomatik dijital kayıt

## Çalıştırma

Uygulama, Node.js üzerinde çalışan Next.js ve TypeScript sayfalarını, API’yi ve PostgreSQL veri katmanını içerir. PostgreSQL’de bir veritabanı oluşturun. Proje kökünde `.env.example` dosyasını `.env.local` olarak kopyalayıp `DATABASE_URL` alanını ayarlayın. İlk çalıştırmada uygulama tabloları hazırlar.

Proje kökünde `yarn install` ve `yarn dev` çalıştırın. Ana sayfa `http://127.0.0.1:4173` adresindedir. Üretim derlemesi için `yarn build`, derlenmiş uygulamayı başlatmak için `yarn start` kullanın. TLS sonlandıran bir ters vekil kullanılıyorsa `MUTERMINAL_PUBLIC_ORIGIN` dışarıdan kullanılan HTTPS adresiyle eşleşmelidir.

## Mevcut MongoDB verisini aktarma

1. Eski uygulamaya yazmayı geçici olarak durdurun. MongoDB aktarım sırasında açık kalmalıdır. Gerekirse `MONGODB_URI` ve `MONGODB_DATABASE` ile eski kayda işaret edin. Varsayılan kaynak `127.0.0.1:27017` üzerindeki `muterminal` veritabanıdır.
2. `yarn db:migrate:mongo` ile kaynak sayımlarını inceleyin. Bu komut veri yazmaz.
3. `yarn db:migrate:mongo --apply` ile PostgreSQL’e aktarın. Aktarım her kaydı hedefte doğrular. Kaynak değişirse veya hedefte aynı kimliğe sahip farklı bir kayıt varsa işlem geri alınır. Aynı içerik tekrar çalıştırıldığında yinelenmez.
4. Başarılı aktarımdan sonra Next.js uygulamasını başlatın. Ürünler, karar geçmişi, mağazalar, kullanıcı adları, şifre özetleri, yönetici şifre değişiklikleri ve sistem ayarları korunur. Eski tarayıcı oturumları uygulama değişiminde yeniden giriş gerektirir.

MongoDB sürücüsü yalnızca aktarım aracında kullanılır. Uygulamanın çalışma zamanı PostgreSQL’e bağlıdır.

Vercel üretim ortamında `DATABASE_URL` için Vercel’den erişilebilen bir PostgreSQL bağlantısı ve `MUTERMINAL_PUBLIC_ORIGIN` için sitenin HTTPS adresini tanımlayın. İlk yönetici hesabını oluşturmak için `MUTERMINAL_ADMIN_PASSWORD` belirleyin. Tester ve pilot yönetici hesapları isteğe bağlıdır ve sırasıyla `MUTERMINAL_TESTER_PASSWORD` ile `MUTERMINAL_MANAGER_PASSWORD` ayarlandığında oluşturulur. Aşağıdaki varsayılan pilot şifreleri yerel HTTP kurulumu içindir.

Ana sayfa MuTerminal Core ve MuDecision'ı tanıtır. Modüllere erişmek için ana sayfadaki panel girişinde kullanıcı adınızı, şifrenizi ve görseldeki beş harfi girin. Pilot hesabının e-posta adresi `admin@muterminal.com` ve şifresi `1234567890`. Boş bir PostgreSQL veritabanı ilk kez hazırlanırken `MUTERMINAL_ADMIN_EMAIL` ve `MUTERMINAL_ADMIN_PASSWORD` ile hesabı tanımlayabilirsiniz. Oluşturulmuş hesapların şifre özetleri PostgreSQL’de saklanır.

`tester@muterminal.com` hesabının varsayılan şifresi `tester123!`. İlk kurulumda `MUTERMINAL_TESTER_PASSWORD` ile farklı bir başlangıç şifresi verebilirsiniz.

Giriş formunda **Admin**, **Yönetici**, **Personel** veya **Depo** girişini seçin. Pilot admin ve tester, aynı oturumla paneller arasında geçebilir ve açık panelin yetkilerini kullanır. Admin kullanıcı ve mağaza oluşturabilir, hesapları etkinleştirebilir veya devre dışı bırakabilir, ayarları ve tüm mağaza raporlarını yönetebilir. Yönetici kendi mağazasında talepleri değerlendirir. Personel kontrol kaydı ve öneri oluşturur, kendi işlem geçmişini görür. Karar ve depo farkı onayı yöneticiye ve yetkilendirilmiş adminlere açıktır. Varsayılan adminin onay yetkisi `MUTERMINAL_ADMIN_CAN_APPROVE=false` ile kapatılabilir.

**Yönetici girişi** için pilot hesabı `yonetici@muterminal.com`, yerel varsayılan şifresi `1234567890`. Admin ve yönetici, **Personel Yönetimi** sekmesinde her personel için kullanıcı adı ve başlangıç şifresi belirler, şifreyi yeniler ve iş unvanı atar. Admin mağazayı seçer. Yönetici kendi mağazasındaki hesapları yönetir. Personel, ana sayfadaki **Personel girişi** düğmesiyle kendi hesabını kullanır.

Yeni personel hesaplarında dört iş unvanından biri seçilir. Yönetici **Personel Yönetimi**, admin ise **Sistem Yönetimi** bölümünden unvan atayabilir veya güncelleyebilir. Mevcut personel reyon atamaları iş unvanlarına karşılık gelir ve personel kendi unvanını panelinde görür.

## İlk MVP’nin altı temel modülü

**MuScan** geliştirme aşamasındadır. Pilot tester hesabı ekranı ve API'yi test edebilir. Prosedürler tamamlanıp açılış onayı verildiğinde sunucu ortamında `MUTERMINAL_SCAN_ENABLED=true` ile personel erişimi etkinleştirilebilir. Mevcut kontrol kayıtları Core işlem geçmişinde saklanır. Scan işlem geçmişindeki bekleyen ve sonuçlanan talepler, Türkçe veya İngilizce PDF, Excel ve JSON olarak indirilebilir.

Ürün kaydederken ana reyon veya alt reyon seçilir. **Kasa Reyon**, **Kasap**, **Şarküteri**, **Meyve Sebze** ve **Unlu Mamuller** ana reyonları Core kayıtlarını, MuDecision dosyalarını ve karar geçmişini filtreler. Kasa Reyon altında 22 hazır alt reyon bulunur. Admin, **Sistem Yönetimi → Reyon tanımları** bölümünden ana reyonlara yeni alt seçenekler ekleyebilir. Eski reyon kimlikleri aynı şekilde kullanılır. Reyon bilgisi bulunmayan kayıtlar **Reyon atanmamış** altında görünür ve Core listesinden ilgili reyona atanabilir.

Core ve MuDecision listelerinde **🗑️ Sil** düğmesi, onaydan sonra seçilen operasyon kaydını ve o kayda bağlı karar geçmişini kalıcı olarak siler.

- **MuBlock** — RKS, delist ve geçici blokaj kontrolleri.
  - **RKS Blokaj** — Blokaj nedeni, inceleme kararı ve blokaj kaldırma talebi.
  - **Delist Blokaj** — Listeden çıkarma nedeni, blokaj durumu ve inceleme kararı.
  - **Geçici Blokaj** — Blokaj nedeni ve Türkiye saatiyle bitiş. Süre dolunca **Blokajı kaldır** ile karar gerekçesi kaydedilir ve geçici blokaj kaydı **Normal** durumuna geçer.
- **SKT Kontrol · MuExpiry** — Lot ve son kullanma tarihi, yaklaşan veya geçmiş tarih göstergesi, ayırma ve iade kararı.
- **Depo İade · MuReturn** — İade gerekçesi ve miktarı, gönderim, teslim ve sorun takibi.
- **Depo Fark · MuDifference** — Sistem stoku ile fiziksel sayım karşılaştırması, düzeltme talebi ve onay veya ret.
- **MuDecision** — Core kayıtlarını barkod ve lot bazında canlı karar dosyalarında toplar. Operasyon kaydına ve lot geçmişine doğrudan geçilebilir. Satılabilirlik ön onayı, inceleme ve depo iadesi değerlendirmeleri karar gerekçesiyle kaydedilir.
- **Karar Geçmişi · MuLog** — Ürün ve lot bazında tarih, beyan edilen personel, gerekçe ve sonuç. Filtrelenen kararlar Türkçe veya İngilizce PDF, Excel ve JSON raporu olarak indirilebilir. Ham kayıtların JSON dışa aktarımı da kullanılabilir.

Operasyon kararları ve satılabilirlik değerlendirmeleri gerekçeleriyle PostgreSQL’de saklanır. Değişiklikler açık sekmelerde otomatik güncellenir. Eski kayıtların eksik operasyon alanları **Bilgileri tamamla** ile doldurulabilir. Önceki kararlar geçmişte saklanır.

Satış ön onayı MuTerminal’de kaydedilir. RKS blokajının kaldırılması, SKT uygunluğu ve stok hareketleri yetkili sistemlerde ayrıca doğrulanmalıdır.

### Pilotun dört destek modülü

| Modül | Öncelik | Kullanım |
| --- | --- | --- |
| **MuScan Lite** | Kritik | Barkodu kamerayla okutun, harici okuyucuyla tarayın veya elle girin. Mağazadaki kayıtları açabilir ya da ürün adı ve barkodla bir kontrol başlatabilirsiniz. Admin mağaza filtresinden ilgili mağazayı seçerek barkod ve ürün adını pilot kataloğa kaydedebilir. Katalog PostgreSQL’de saklanır ve ERP bağlantısı gerektirmez. |
| **MuApproval Lite** | Kritik | Personel MuDecision veya operasyon kaydından talep oluşturur. Yönetici ya da yetkili admin gerekçe girerek onaylar, reddeder veya ek kontrol ister. Talep sahibi ek kontrolden sonra yeni gerekçeyle yeniden gönderir. İlk talep, inceleme ve sonraki gönderim geçmişte kalır. |
| **MuEvidence** | Yüksek | Yeni kontrol kaydına veya karar talebine hasarlı ambalaj, ürün etiketi ya da SKT fotoğrafı eklenebilir. Tarayıcı fotoğrafı en fazla 512 KB JPEG olarak hazırlar. Fotoğrafı yetkili yönetici ve admin ile fotoğrafı ekleyen personel açabilir. |
| **MuDashboard Lite** | Yüksek | Yönetici ve admin seçili mağaza ve reyon kapsamında kontrol sayısını, bekleyen onayları, ortalama inceleme süresini, SKT risklerini ve aranabilir ürün işlem geçmişini görür. Süre, gönderim ve inceleme zamanı bulunan talepler üzerinden hesaplanır. |

### El terminaliyle pilot çalışma akışı

**MuScan Lite** barkod veya ürün koduyla mağazaya ait kataloğu ve operasyon kayıtlarını açar. **MuProduct** kartı barkod, ürün kodu, fiyat, fiyat geçerlilik dönemi, koli içi miktar, sipariş durumu ve varsa kaynak satış durumunu gösterir. **MuStock Lite** depo koduna göre kaynaktan alınan miktarı ve güncelleme saatini listeler. Operasyon kayıtlarında lot, SKT ve ilgili RKS veya kontrol durumu incelenebilir.

Personel ürün kartından mevcut bir lot kaydını açabilir veya yeni kontrol başlatabilir. MuApproval Lite işleme ait gerekçeyi ve yönetici incelemesini kaydeder. MuTrace Lite aynı mağaza ve barkoda ait yetki kapsamındaki karar geçmişini açar. Kontrol, karar ve onay işlemleri CORE kayıtlarını günceller. Kaynak stok miktarları PostgreSQL’de ayrı `inventory_snapshots` tablosunda saklanır. Depo koduna ait miktar, tek başına fiziksel sayım farkını göstermez. Fiziksel fark MuDifference üzerinden kaydedilir.

**MuSync Lite** ile Admin yetkili bir kaynaktan aldığı UTF-8 CSV’yi seçili mağaza için aktarabilir. Tüm mağazalar seçiliyken pilot mağaza kullanılır. MuScan Lite’daki şablon aşağıdaki başlık sırasını kullanır.

```csv
barcode,product_code,product_name,price_try,case_quantity,price_valid_from,price_valid_to,order_status,sale_status,warehouse_code,stock_quantity,source_updated_at
```

- Barkod ve ürün adı zorunludur. Fiyat TL cinsinden girilir. Tarihler `YYYY-MM-DD` biçimindedir. Kaynak satış durumu `sellable`, `blocked` veya `unknown` olabilir.
- Depo stoğu aktarılacaksa depo kodu, miktar ve saat dilimi içeren kaynak zamanı birlikte girilir. Aynı ürün birden fazla depoda bulunuyorsa ürün bilgileri her satırda aynı olmalıdır. Başında sıfır olan depo kodları CSV’de metin olarak korunur.
- Aktarımda 1–500 satır kabul edilir. Bir satır geçersizse aktarım uygulanmaz. Aynı depo ve barkod için eşit veya eski zamanlı stok kaydı atlanır. Ürün kartı bilgileri son başarılı katalog aktarımından alınır.

Canlı ERP/WMS bağlantısı için yetkili API erişimi ve kurumsal izin gerekir. Pilot katalog elle veya CSV ile doldurulabilir.

## Aşama 3 · MuTerminal Operations (6–12 ay)

**Cross-Dock · MuDock**, depo ve dağıtım kapsamındaki bu aşamada **MuWarehouse** ve **MuTransfer** ile birlikte geliştirilecektir. Bu sıralama, ilk pilotun mağaza içi ürün kararlarına odaklanmasını sağlar ve depo ile sevkiyat entegrasyonlarını sonraki aşamaya bırakır.

Gerçek depo ve sevkiyat verilerine erişim sağlandığında Cross-Dock uygunluk kontrolleri, lot için varış noktası önerileri ve onay kayıtları geliştirilecektir. MuDecision’daki **Cross-Dock Uygun** kararı için ilgili operasyon kaydının sevkiyata uygun durumda olması ve lotta açık engel bulunmaması gerekir.

MuDock ilk MVP’de varsayılan olarak kapalıdır. Mevcut kayıtlar ve karar geçmişi görüntülenebilir. Akış doğrulandıktan sonra sunucu ortamında `MUTERMINAL_CROSS_DOCK_ENABLED=true` ayarlanarak modül etkinleştirilebilir.

## Kurumsal entegrasyon kapsamı
MVP girişleri, rol ve mağaza yetkilerini ve gerekçeli onayları PostgreSQL’de tutar. Kurumsal SSO, harici denetim arşivi ve ERP/WMS bağlantıları ayrı kurulum gerektirir. RKS blokajını kaldırma, satışa açma ve resmî stok düzeltmesi yetkili ERP/WMS süreçlerinde yürütülür.

## MU TRACE

Ana sayfadaki veya paneldeki **MU TRACE** bağlantısından `/trace` ekranını açın. Barkod, ürün kodu ya da GS1 Digital Link QR ile sorgulayın. QR içindeki lot sorguya uygulanır. HTTPS veya localhost üzerinden kamera taraması yapılabilir. Klavye gibi çalışan bir okuyucu veya elle giriş de kullanılabilir.

- Ürün ve lot ekranı, kapsam dahilindeki CORE kontrol ve lojistik kayıtlarını, SKT/RKS durumunu ve yetkiye göre geçmişi gösterir. MuTerminal Scan etkinse mevcut CORE personeli seçili barkod ve lotla fiziksel kontrol ekranına geçebilir.
- MU TRACE kontrolü kullanıcı, ürün, konum, zaman, RKS/SKT, fiziksel sonuç, öneri ve gerekçeyi içerir. Yetkili ve farklı bir kullanıcı gerekçeyle onaylar, reddeder veya ek kontrol ister. Talep sahibi ek kontrolü önceki kayda bağlar. Kontroller ve incelemeler ayrı PostgreSQL kayıtlarıdır.
- Önceki sürümden bekleyen MU TRACE talepleri yeni kuyruğa alınır. Özgün öneri geçmişte görünür, eski satış ön onayı önerileri inceleme talebi olarak devam eder.
- Geri çağırma yetkisi olan kullanıcı kaydı mağaza, barkod ve lot için gerekçeyle açıp kapatır. Satışa açma yetkili kaynak sistem ve ilgili kalite kontrollerinde doğrulanır. MU TRACE onayı operasyon kararını kaydeder.
- Personel kendi kontrol özetini görür. Diğer operasyon ve denetim rolleri kapsamlarına göre bekleyen talepleri, riskli lotları, hareketleri ve açık geri çağırmaları raporlar. Raporlar Türkçe veya İngilizce PDF, Excel ve JSON olarak indirilebilir.

### MU TRACE rolleri

| Rol | Yetki kapsamı |
| --- | --- |
| Süper Admin | Firma ve firma admini yönetimi. Yeni firmaların varsayılan SKT uyarı ayarı. Müşteri ürünü sorgusu ve raporu kapalıdır. |
| Firma Admini | Kendi firmasında kullanıcı, mağaza, depo, lot ataması, hareket, geçmiş, rapor ve SKT uyarı ayarı. Kontrol/talep ve karar/geri çağırma ayrı izinlerle verilir. |
| Mağaza Yöneticisi | Atanmış mağazada personel yönetimi, sorgu, kontrol, bağımsız inceleme, mağaza aşaması hareketi, geri çağırma ve rapor. |
| Depo / Lojistik Yetkilisi | Atanmış depodaki lotlar, depolama ve lojistik hareketleri, kontroller ve depo raporu. İnceleme yetkisi kendi deposundaki başka bir kullanıcının depo teslim kontrolüyle sınırlıdır. |
| Personel | Mağaza ürün sorgusu, RKS/SKT ve fiziksel kontrol, gerekçeli karar talebi, ek kontrol ve kişisel özet. |
| Denetçi | Atanmış mağaza veya firma kapsamında salt okunur ürün, karar, hareket ve rapor erişimi. |

Mevcut CORE Admin, Yönetici ve Personel hesapları MU TRACE’te pilot firma kapsamına eşlenir. MU TRACE yönetim ekranında oluşturulan hesaplar giriş için `/trace` formunu kullanır. Yönetim ekranından kapsam düzenlenebilir, şifre yenilenebilir ve hesap devre dışı bırakılabilir. Firma admini, lot ekranındaki **Depo lot ataması** ile bir lotu aynı mağazaya bağlı depoya yetkilendirir.

Pilot **Depo Görevlisi** hesabı `depo@muterminal.com` adresini kullanır. İlk hazırlama için `MUTERMINAL_TRACE_PILOT_WAREHOUSE_PASSWORD` ayarlanır. İsteğe bağlı platform hesabı `MUTERMINAL_TRACE_SUPER_EMAIL` ve `MUTERMINAL_TRACE_SUPER_PASSWORD` ile hazırlanır.

Ortamda tanımlanan pilot admin, tester, yönetici ve depo şifrelerini mevcut hesaplara bir kez uygulamak için `MUTERMINAL_PILOT_PASSWORD_REVISION` değerini değiştirin. Aynı değerle sonraki başlatmalarda panelden yapılan şifre değişiklikleri korunur.

Üretimden tüketiciye kadar aşamalar kaydedilen verilerle görünür. Canlı üretici, ERP, WMS ve taşıyıcı verileri için kaynak bağlantıları ayrıca kurulmalıdır.

### PostgreSQL kurulumu

Mevcut `DATABASE_URL` kullanılabilir. İlk veritabanı erişiminde uygulama MU TRACE tablolarını ve indekslerini mevcut şemaya ekler. Boş bir yerel veritabanı için isteğe bağlı `compose.yaml` kullanılabilir. `.env.local` dosyasında `MUTERMINAL_POSTGRES_PASSWORD` ve aynı parolayı kullanan `DATABASE_URL` değerini ayarlayın, ardından proje kökünde `docker compose --env-file .env.local up -d postgres` komutunu çalıştırın. 5432 portu doluysa `MUTERMINAL_POSTGRES_PORT` ve bağlantı adresindeki portu birlikte değiştirin. `yarn dev` ile yerel uygulama `http://127.0.0.1:4173/trace` adresinden açılır.

### MU TRACE Mobil

Android uygulaması APK olarak dağıtılır. Uygulama, sitenin `/mobil` ekranını Trusted Web Activity içinde açar ve mevcut MuTerminal veya MU TRACE hesabını kullanır. Tarama, kontrol ve rapor işlemleri için cihazın HTTPS üzerinden sunucuya erişmesi gerekir.

1. JDK 17, Gradle 8.13 ve Android SDK 36 ile çalışın. `MUTERMINAL_PUBLIC_ORIGIN` ortam değişkenini sitenin HTTPS adresine ayarlayın ve proje kökünde `gradle -p android :app:assembleRelease` çalıştırın.
2. `android/app/build/outputs/apk/release/app-release-unsigned.apk` dosyasını `zipalign` ile hizalayın ve dağıtım anahtarınızla `apksigner sign` kullanarak `muterminal.apk` dosyasını oluşturun. İmzayı `apksigner verify --print-certs muterminal.apk` ile doğrulayın. Sonraki sürümlerde aynı anahtarı kullanın ve Android `versionCode` değerini artırın. [Android imzalama kılavuzu](https://developer.android.com/build/building-cmdline#sign_cmdline)
3. `public/.well-known/assetlinks.json` dosyasına aşağıdaki Digital Asset Links kaydını ekleyin. Örnek parmak izi yerine APK imzasının iki noktayla ayrılmış SHA-256 parmak izini yazın. [Trusted Web Activity kurulum kılavuzu](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide/)

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.muterminal.mobile",
       "sha256_cert_fingerprints": ["APK_SHA256_PARMAK_IZI"]
     }
   }]
   ```

4. İmzalı dosyayı `public/mobil/muterminal.apk` konumuna ekleyin ve `MUTERMINAL_ANDROID_APK_URL=/mobil/muterminal.apk` ayarını yapın. Harici sunucuda bir `.apk` HTTPS bağlantısı kullanıyorsanız dosyayı `Content-Disposition: attachment` başlığıyla sunun. Bu ayar ana sayfadaki indirme düğmesini etkinleştirir.

Bağlantı kesildiğinde uygulama yeniden deneme ekranını gösterir. Ürün ve kişisel kayıtlar ile işlem yazma istekleri bağlantı gerektirir.

Personel, kullanıcı adı ve şifresinden sonra kendisine atanmış mobil onay kodunu girer. Henüz kod atanmamışsa mobil çalışma alanı kilitli görünür. Firma admini ve mağaza yöneticisi doğrudan giriş yapabilir. **Yönetim → Personel mobil onay kodları** bölümünden kendi firma veya mağaza kapsamlarındaki CORE ve MU TRACE personeline kod oluşturabilirler.

Yeni kod yalnızca oluşturulduğu anda görünür ve ilgili personele özel olarak iletilir. Kod yenilendiğinde veya mobil erişim kilitlendiğinde mevcut mobil oturumların onayı geçersiz olur.

### Cihaz bildirimlerini devreye alma

Bildirimler varsayılan olarak kapalıdır. Etkinleştirmek için HTTPS sunucusunda `MUTERMINAL_NOTIFICATIONS_ENABLED=true` ayarlayın. `yarn web-push generate-vapid-keys` ile bir kez oluşturduğunuz anahtarları `MUTERMINAL_VAPID_PUBLIC_KEY` ve `MUTERMINAL_VAPID_PRIVATE_KEY` olarak kaydedin. `MUTERMINAL_VAPID_SUBJECT` için yönetilen bir `mailto:` adresi kullanın. Özel anahtar yalnızca sunucuda ve gönderim sürecinde bulunmalıdır.

Kuyruğu arka planda çalıştırmak için aynı veritabanı ve bildirim ayarlarıyla `yarn notifications:worker` çalıştırın. Sunucusuz barındırmada zamanlayıcıdan `GET /api/notifications/dispatch` çağırın ve `Authorization: Bearer <MUTERMINAL_NOTIFICATION_DISPATCH_TOKEN>` başlığını gönderin. Zamanlayıcının aralığı gönderim sıklığını belirler. SKT taraması Türkiye saatini ve Sistem Yönetimi’ndeki uyarı süresini kullanır.

Kullanıcılar cihaz başına **Bildirimler → Bildirimleri aç** seçeneğini kullanır. Android APK için güncel imzalı sürüm ve Digital Asset Links eşleşmesi gerekir. iPhone ve iPad’de iOS/iPadOS 16.4 veya üzeri sürümde MuTerminal’i Ana Ekran’a ekleyip oradan açın. [Android TWA bildirim servisi](https://developer.chrome.com/docs/android/trusted-web-activity/android-browser-helper-migration) · [Apple Web Push desteği](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
