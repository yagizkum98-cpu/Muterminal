# MuTerminal MVP

FİLE Market için önerilen bağımsız pilot prototip.

## Çalıştırma
MongoDB çalışırken proje kökünde `yarn install` ve `yarn dev` çalıştırın. Ardından tarayıcıda `http://127.0.0.1:4173` adresini açın.
Sunucu varsayılan olarak `mongodb://127.0.0.1:27017` adresindeki `muterminal` veritabanına bağlanır. Farklı bir bağlantı için `MONGODB_URI` ve `MONGODB_DATABASE` ortam değişkenlerini kullanın.

## Operasyon modülleri

- **RKS Blokaj · MuRisk** — Blokaj nedeni, inceleme kararı ve blokaj kaldırma talebi.
- **Delist Blokaj · MuRisk** — Listeden çıkarma nedeni, blokaj durumu ve inceleme kararı.
- **Geçici Blokaj · MuRisk** — Blokaj nedeni ve Türkiye saatiyle bitiş. Süre dolunca **Blokajı kaldır** ile karar gerekçesi kaydedilir ve geçici blokaj kaydı **Normal** durumuna geçer.
- **SKT Kontrol · MuRisk** — Lot ve son kullanma tarihi, yaklaşan veya geçmiş tarih göstergesi, ayırma ve iade kararı.
- **Depo İade · MuReturn** — İade gerekçesi ve miktarı, gönderim, teslim ve sorun takibi.
- **Depo Fark · MuDifference** — Sistem stoku ile fiziksel sayım karşılaştırması, düzeltme talebi ve onay veya ret.
- **Cross-Dock · MuDock** — Sevkiyata uygunluk değerlendirmesi ve uygun lot için varış noktası.
- **Karar Geçmişi · MuTrace** — Ürün ve lot bazında tarih, beyan edilen personel, gerekçe ve sonuç. Tarih ve operasyon filtresi, arama ve JSON dışa aktarımı.

MuDecision, operasyon kararlarını gerekçeleriyle MongoDB'de saklar. Değişiklikler açık sekmelerde otomatik güncellenir. Eski kayıtların eksik operasyon alanları **Bilgileri tamamla** ile doldurulabilir. Önceki kararlar geçmişte saklanır.

Satış ön onayı MuTerminal’de kaydedilir. RKS blokajının kaldırılması, SKT uygunluğu ve stok hareketleri yetkili sistemlerde ayrıca doğrulanmalıdır.

## Üretime geçiş için
Next.js + TypeScript arayüz, Node.js API, PostgreSQL, RBAC, kurumsal SSO, sunucu tarafı değiştirilemez denetim izi, ERP/WMS entegrasyonları, lot/seri bazlı izlenebilirlik, barkod okuyucu ve onay akışları gereklidir. Bu prototipte verilen kararlar gerçek stok blokajını kaldırmaz veya satışa açmaz. SKT geçmiş, geri çağrılmış ya da güvenlik riski taşıyan ürünler için satış onayı verilmemelidir.
