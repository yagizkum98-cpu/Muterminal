# MuTerminal Core · Aşama 1

FİLE Market için 0–3 aylık MVP pilotu. Temel operasyonları ve gerekçeli manuel kararları mağaza bazında kaydeder. Eski kayıtlar Pilot Mağaza altında görünür.

## Çalıştırma

Uygulama, Node.js üzerinde çalışan Next.js ve TypeScript sayfalarını, API’yi ve PostgreSQL veri katmanını içerir. PostgreSQL’de bir veritabanı oluşturun. Proje kökünde `.env.example` dosyasını `.env.local` olarak kopyalayıp `DATABASE_URL` alanını ayarlayın. İlk çalıştırmada uygulama tabloları hazırlar.

Proje kökünde `yarn install` ve `yarn dev` çalıştırın. Ana sayfa `http://127.0.0.1:4173` adresindedir. Üretim derlemesi için `yarn build`, derlenmiş uygulamayı başlatmak için `yarn start` kullanın. TLS sonlandıran bir ters vekil kullanılıyorsa `MUTERMINAL_PUBLIC_ORIGIN` dışarıdan kullanılan HTTPS adresiyle eşleşmelidir.

## Mevcut MongoDB verisini aktarma

1. Eski uygulamaya yazmayı geçici olarak durdurun. MongoDB aktarım sırasında açık kalmalıdır. Gerekirse `MONGODB_URI` ve `MONGODB_DATABASE` ile eski kayda işaret edin. Varsayılan kaynak `127.0.0.1:27017` üzerindeki `muterminal` veritabanıdır.
2. `yarn db:migrate:mongo` ile kaynak sayımlarını inceleyin. Bu komut veri yazmaz.
3. `yarn db:migrate:mongo --apply` ile PostgreSQL’e aktarın. Aktarım her kaydı hedefte doğrular. Kaynak değişirse veya hedefte aynı kimliğe sahip farklı bir kayıt varsa işlem geri alınır. Aynı içerik tekrar çalıştırıldığında yinelenmez.
4. Başarılı aktarımdan sonra Next.js uygulamasını başlatın. Ürünler, karar geçmişi, mağazalar, kullanıcı adları, şifre özetleri, yönetici şifre değişiklikleri ve sistem ayarları korunur. Eski tarayıcı oturumları uygulama değişiminde yeniden giriş gerektirir.

MongoDB sürücüsü yalnızca aktarım aracında kullanılır. Uygulamanın çalışma zamanı PostgreSQL’e bağlıdır.

Ana sayfa MuTerminal Core ve MuDecision'ı tanıtır. Modüllere erişmek için ana sayfadaki panel girişinde kullanıcı adınızı, şifrenizi ve görseldeki beş harfi girin. Pilot hesabının e-posta adresi `admin@muterminal.com` ve şifresi `1234567890`. Boş bir PostgreSQL veritabanı ilk kez hazırlanırken `MUTERMINAL_ADMIN_EMAIL` ve `MUTERMINAL_ADMIN_PASSWORD` ile hesabı tanımlayabilirsiniz. Oluşturulmuş hesapların şifre özetleri PostgreSQL’de saklanır.

`tester@muterminal.com` hesabının varsayılan şifresi `tester123!`. İlk kurulumda `MUTERMINAL_TESTER_PASSWORD` ile farklı bir başlangıç şifresi verebilirsiniz.

Giriş formunda **Admin**, **Manager** veya **Staff** panelini seçin. Tester hesabı üç panele de aynı bilgilerle girer ve oturumda seçtiği panelin yetkilerini kullanır. Admin kullanıcı ve mağaza oluşturabilir, hesapları etkinleştirebilir veya devre dışı bırakabilir, ayarları ve tüm mağaza raporlarını yönetebilir. Yönetici yalnızca kendi mağazasında talepleri değerlendirir. Personel kontrol kaydı ve öneri oluşturur, kendi işlem geçmişini görür. Karar ve depo farkı onayı yöneticiye ve yetkilendirilmiş adminlere açıktır. Varsayılan adminin onay yetkisi `MUTERMINAL_ADMIN_CAN_APPROVE=false` ile kapatılabilir.

**Yönetici girişi** için pilot hesabı `yonetici@muterminal.com`, başlangıç şifresi `1234567890`. Yönetici panelindeki **Personel Yönetimi** sekmesinde ad soyad ve kullanıcı adı girerek personel hesabı oluşturulur. İlk şifre boş bırakılırsa `1234567890` kullanılır. Yönetici kendi şifresini ve mağazasındaki personelin şifrelerini değiştirebilir. Personel, ana sayfadaki **Personel girişi** düğmesiyle kendi hesabını kullanır.

Yeni personel hesaplarında dört iş unvanından biri seçilir. Yönetici **Personel Yönetimi**, admin ise **Sistem Yönetimi** bölümünden unvan atayabilir veya güncelleyebilir. Mevcut personel reyon atamaları iş unvanlarına karşılık gelir ve personel kendi unvanını panelinde görür.

## Operasyon modülleri

**MuScan** geliştirme aşamasındadır. Personel panelinde durum bilgisi gösterilir. Prosedürler tamamlanıp açılış onayı verildiğinde sunucu ortamında `MUTERMINAL_SCAN_ENABLED=true` ile ekran ve API etkinleştirilebilir. Mevcut kontrol kayıtları Core işlem geçmişinde saklanır.

Ürün kaydederken ana reyon veya alt reyon seçilir. **Kasa Reyon**, **Kasap**, **Şarküteri**, **Meyve Sebze** ve **Unlu Mamuller** ana reyonları Core kayıtlarını, MuDecision dosyalarını ve karar geçmişini filtreler. Kasa Reyon altında 20 hazır alt reyon bulunur. Admin, **Sistem Yönetimi → Reyon tanımları** bölümünden ana reyonlara yeni alt seçenekler ekleyebilir. Eski reyon kimlikleri aynı şekilde kullanılır. Reyon bilgisi bulunmayan kayıtlar **Reyon atanmamış** altında görünür ve Core listesinden ilgili reyona atanabilir.

Core ve MuDecision listelerinde **🗑️ Sil** düğmesi, onaydan sonra seçilen operasyon kaydını ve o kayda bağlı karar geçmişini kalıcı olarak siler.

- **RKS Blokaj · MuBlock** — Blokaj nedeni, inceleme kararı ve blokaj kaldırma talebi.
- **Delist Blokaj · MuBlock** — Listeden çıkarma nedeni, blokaj durumu ve inceleme kararı.
- **Geçici Blokaj · MuBlock** — Blokaj nedeni ve Türkiye saatiyle bitiş. Süre dolunca **Blokajı kaldır** ile karar gerekçesi kaydedilir ve geçici blokaj kaydı **Normal** durumuna geçer.
- **SKT Kontrol · MuExpiry** — Lot ve son kullanma tarihi, yaklaşan veya geçmiş tarih göstergesi, ayırma ve iade kararı.
- **Depo İade · MuReturn** — İade gerekçesi ve miktarı, gönderim, teslim ve sorun takibi.
- **Depo Fark · MuDifference** — Sistem stoku ile fiziksel sayım karşılaştırması, düzeltme talebi ve onay veya ret.
- **Cross-Dock · MuDock** — Sevkiyata uygunluk değerlendirmesi ve uygun lot için varış noktası.
- **MuDecision** — Core kayıtlarını barkod ve lot bazında canlı karar dosyalarında toplar. Operasyon kaydına ve lot geçmişine doğrudan geçilebilir. Satılabilirlik ön onayı, inceleme, depo iadesi ve Cross-Dock uygunluğu değerlendirmeleri karar gerekçesiyle kaydedilir. Cross-Dock uygunluğu için aynı operasyon kaydının sevkiyata uygun durumda olması ve lotta açık engel bulunmaması gerekir.
- **Karar Geçmişi · MuLog** — Ürün ve lot bazında tarih, beyan edilen personel, gerekçe ve sonuç. Tarih ve operasyon filtresi, arama ve JSON dışa aktarımı.

Operasyon kararları ve satılabilirlik değerlendirmeleri gerekçeleriyle PostgreSQL’de saklanır. Değişiklikler açık sekmelerde otomatik güncellenir. Eski kayıtların eksik operasyon alanları **Bilgileri tamamla** ile doldurulabilir. Önceki kararlar geçmişte saklanır.

Satış ön onayı MuTerminal’de kaydedilir. RKS blokajının kaldırılması, SKT uygunluğu ve stok hareketleri yetkili sistemlerde ayrıca doğrulanmalıdır.

## Kurumsal entegrasyon kapsamı
MVP girişleri, rol ve mağaza yetkilerini ve gerekçeli onayları PostgreSQL’de tutar. Kurumsal SSO, harici denetim arşivi ve ERP/WMS bağlantıları ayrı kurulum gerektirir. RKS blokajını kaldırma, satışa açma ve resmî stok düzeltmesi yetkili ERP/WMS süreçlerinde yürütülür.

## MU TRACE

Ana sayfadaki veya paneldeki **MU TRACE** bağlantısından `/trace` ekranını açın. Barkod, ürün kodu ya da GS1 Digital Link QR ile sorgulayın. QR içindeki lot sorguya uygulanır. HTTPS veya localhost üzerinden kamera taraması yapılabilir. Klavye gibi çalışan bir okuyucu veya elle giriş de kullanılabilir.

- Ürün ve lot ekranı, kapsam dahilindeki CORE kontrol ve lojistik kayıtlarını, SKT/RKS durumunu ve yetkiye göre geçmişi gösterir. MuTerminal Scan etkinse mevcut CORE personeli seçili barkod ve lotla fiziksel kontrol ekranına geçebilir.
- MU TRACE kontrolü kullanıcı, ürün, konum, zaman, RKS/SKT, fiziksel sonuç, öneri ve gerekçeyi içerir. Yetkili ve farklı bir kullanıcı gerekçeyle onaylar, reddeder veya ek kontrol ister. Talep sahibi ek kontrolü önceki kayda bağlar. Kontroller ve incelemeler ayrı PostgreSQL kayıtlarıdır.
- Önceki sürümden bekleyen MU TRACE talepleri yeni kuyruğa alınır. Özgün öneri geçmişte görünür, eski satış ön onayı önerileri inceleme talebi olarak devam eder.
- Geri çağırma yetkisi olan kullanıcı kaydı mağaza, barkod ve lot için gerekçeyle açıp kapatır. Satışa açma yetkili kaynak sistem ve ilgili kalite kontrollerinde doğrulanır. MU TRACE onayı operasyon kararını kaydeder.
- Personel kendi kontrol özetini görür. Diğer operasyon ve denetim rolleri kapsamlarına göre bekleyen talepleri, riskli lotları, hareketleri ve açık geri çağırmaları raporlar. Bu rapor JSON olarak indirilebilir.

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

Pilot **Depo Görevlisi** hesabı `depo@muterminal.com` adresini kullanır. İlk hazırlama için yerel ortamda `MUTERMINAL_TRACE_PILOT_WAREHOUSE_PASSWORD` ayarlanır. İsteğe bağlı platform hesabı `MUTERMINAL_TRACE_SUPER_EMAIL` ve `MUTERMINAL_TRACE_SUPER_PASSWORD` ile hazırlanır. Bu başlangıç değerleri mevcut hesapların şifresini değiştirmez. Sonraki şifre yenilemeleri MU TRACE yönetim ekranından yapılır. Kurumsal OIDC/MFA için kimlik sağlayıcısı yapılandırması gerekir.

Üretimden tüketiciye kadar aşamalar kaydedilen verilerle görünür. Canlı üretici, ERP, WMS ve taşıyıcı verileri için kaynak bağlantıları ayrıca kurulmalıdır.

### PostgreSQL kurulumu

Mevcut `DATABASE_URL` kullanılabilir. İlk veritabanı erişiminde uygulama MU TRACE tablolarını ve indekslerini mevcut şemaya ekler. Boş bir yerel veritabanı için isteğe bağlı `compose.yaml` kullanılabilir. `.env.local` dosyasında `MUTERMINAL_POSTGRES_PASSWORD` ve aynı parolayı kullanan `DATABASE_URL` değerini ayarlayın, ardından proje kökünde `docker compose --env-file .env.local up -d postgres` komutunu çalıştırın. 5432 portu doluysa `MUTERMINAL_POSTGRES_PORT` ve bağlantı adresindeki portu birlikte değiştirin. `yarn dev` ile yerel uygulama `http://127.0.0.1:4173/trace` adresinden açılır.

### MU TRACE Mobil

`/mobil` telefon için kurulabilir web uygulamasının (PWA) ana ekranıdır. Aynı MuTerminal veya MU TRACE hesabı ve mevcut firma, mağaza, depo yetkileri kullanılır. Ürün tarama, kontrol, karar talepleri, onay, geri çağırma, rapor ve yönetim ekranları ortak sunucuya bağlıdır. CORE ve MuTerminal Scan bağlantıları ilgili yetki ve özellik ayarına göre görünür.

Telefondan erişim ve kamera için uygulamayı bir HTTPS adresinde sunun ve `MUTERMINAL_PUBLIC_ORIGIN` değerini bu adresle eşleştirin. Android’de tarayıcıdan **Uygulamayı yükle**, iPhone’da Safari’den **Paylaş → Ana Ekrana Ekle → Web Uygulaması Olarak Aç** seçilebilir. Yerel geliştirmede `http://127.0.0.1:4173/mobil` kullanılır.

Bağlantı kesildiğinde uygulama yeniden deneme ekranını gösterir. Ürün ve kişisel kayıtlar ile işlem yazma istekleri bağlantı gerektirir. Service worker yalnızca herkese açık bağlantı ekranını önbelleğe alır.

Personel, kullanıcı adı ve şifresinden sonra kendisine atanmış mobil onay kodunu girer. Henüz kod atanmamışsa mobil çalışma alanı kilitli görünür. Firma admini ve mağaza yöneticisi doğrudan giriş yapabilir. **Yönetim → Personel mobil onay kodları** bölümünden kendi firma veya mağaza kapsamlarındaki CORE ve MU TRACE personeline kod oluşturabilirler.

Yeni kod yalnızca oluşturulduğu anda görünür ve ilgili personele özel olarak iletilir. Kod yenilendiğinde veya mobil erişim kilitlendiğinde mevcut mobil oturumların onayı geçersiz olur.
