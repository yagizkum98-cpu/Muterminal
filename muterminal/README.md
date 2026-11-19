# MuTerminal Core · Aşama 1

FİLE Market için 0–3 aylık MVP pilotu. Temel operasyonları ve gerekçeli manuel kararları mağaza bazında kaydeder. Eski kayıtlar Pilot Mağaza altında görünür.

## Çalıştırma
MongoDB çalışırken proje kökünde `yarn install` ve `yarn dev` çalıştırın. Ardından tarayıcıda `http://127.0.0.1:4173` adresini açın.
Sunucu varsayılan olarak `mongodb://127.0.0.1:27017` adresindeki `muterminal` veritabanına bağlanır. Farklı bir bağlantı için `MONGODB_URI` ve `MONGODB_DATABASE` ortam değişkenlerini kullanın.

Ana sayfa MuTerminal Core ve MuDecision'ı tanıtır. Modüllere erişmek için ana sayfadaki **Giriş yap** formunda e-posta adresinizi, şifrenizi ve görseldeki beş harfi girin. Pilot hesabının e-posta adresi `admin@muterminal.com` ve şifresi `1234567890`. Bunları sunucu ortamında `MUTERMINAL_ADMIN_EMAIL` ve `MUTERMINAL_ADMIN_PASSWORD` ile değiştirebilirsiniz.

`tester@muterminal.com` hesabının varsayılan şifresi `tester123!`. Şifreyi `MUTERMINAL_TESTER_PASSWORD` ile değiştirebilirsiniz.

Giriş formunda **Admin**, **Manager** veya **Staff** panelini seçin. Tester hesabı üç panele de aynı bilgilerle girer ve oturumda seçtiği panelin yetkilerini kullanır. Admin kullanıcı ve mağaza oluşturabilir, hesapları etkinleştirebilir veya devre dışı bırakabilir, ayarları ve tüm mağaza raporlarını yönetebilir. Yönetici yalnızca kendi mağazasında talepleri değerlendirir. Personel kontrol kaydı ve öneri oluşturur, kendi işlem geçmişini görür. Karar ve depo farkı onayı yöneticiye ve yetkilendirilmiş adminlere açıktır. Varsayılan adminin onay yetkisi `MUTERMINAL_ADMIN_CAN_APPROVE=false` ile kapatılabilir.

**Yönetici girişi** için pilot hesabı `yonetici@muterminal.com`, başlangıç şifresi `1234567890`. Yönetici panelindeki **Personel Yönetimi** sekmesinde ad soyad ve kullanıcı adı girerek personel hesabı oluşturulur. İlk şifre boş bırakılırsa `1234567890` kullanılır. Yönetici kendi şifresini ve mağazasındaki personelin şifrelerini değiştirebilir. Personel, ana sayfadaki **Personel girişi** düğmesiyle kendi hesabını kullanır.

## Operasyon modülleri

Ürün kaydederken reyon seçilir. Admin panelindeki **Reyonlar** düğmeleri Core kayıtlarını, MuDecision dosyalarını ve karar geçmişini filtreler. Önceki kayıtlar **Reyon atanmamış** altında görünür ve Core listesinden ilgili reyona atanabilir.

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

Operasyon kararları ve satılabilirlik değerlendirmeleri gerekçeleriyle MongoDB'de saklanır. Değişiklikler açık sekmelerde otomatik güncellenir. Eski kayıtların eksik operasyon alanları **Bilgileri tamamla** ile doldurulabilir. Önceki kararlar geçmişte saklanır.

Satış ön onayı MuTerminal’de kaydedilir. RKS blokajının kaldırılması, SKT uygunluğu ve stok hareketleri yetkili sistemlerde ayrıca doğrulanmalıdır.

## Üretime geçiş için
Next.js + TypeScript arayüz, Node.js API, PostgreSQL, RBAC, kurumsal SSO, sunucu tarafı değiştirilemez denetim izi, ERP/WMS entegrasyonları, lot/seri bazlı izlenebilirlik, barkod okuyucu ve onay akışları gereklidir. Bu prototipte verilen kararlar gerçek stok blokajını kaldırmaz veya satışa açmaz. SKT geçmiş, geri çağrılmış ya da güvenlik riski taşıyan ürünler için satış onayı verilmemelidir.
