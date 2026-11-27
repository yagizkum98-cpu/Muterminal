const crossDock = 'Cross-Dock';
const display = 'Teşhir';
const hotSale = 'Sıcak Satış';
const recipeControl = 'Reçeteli Ürün';
const recipeChecks = ['Uygun', 'Uygunsuz', 'Doğrulanmadı'];
const recipeCompliance = 'Reçete kontrolü onayı';
const saleApproval = 'Satılabilir (ön onay)';
const assessments = [
  { choice: saleApproval, guarded: true },
  { choice: 'Satılamaz' },
  { choice: 'İncelemede' },
  { choice: 'Depo İade' },
  { choice: 'Cross-Dock Uygun', guarded: true, operation: crossDock, from: ['Sevkiyata uygun', 'Sevkiyata yönlendirildi'] },
];
const operations = {
  'RKS Blokaj': {
    title: 'RKS Blokaj', feature: 'MuBlock',
    description: 'Blokaj nedenlerini inceleyin ve yetkili inceleme sonucunu kaydedin.',
    initial: 'Blokajlı', blockLabel: 'RKS blokajı',
    fields: [{ name: 'blockReason', label: 'Blokaj nedeni', type: 'text', max: 500 }],
    actions: [
      { choice: 'Blokaj devam', requestable: true },
      { choice: 'İncelemeye sevk', requestable: true },
      { choice: 'Blokaj kaldırma talebi', result: 'Yetkili sistem doğrulaması bekliyor', requestable: true },
    ],
  },
  'Delist Blokaj': {
    title: 'Delist Blokaj', feature: 'MuBlock',
    description: 'Listeden çıkarılan ürünlerin blokaj nedenini ve inceleme kararlarını kaydedin.',
    initial: 'Delist blokajlı', blockLabel: 'Delist blokajı',
    fields: [{ name: 'blockReason', label: 'Delist nedeni', type: 'text', max: 500 }],
    actions: [
      { choice: 'Blokaj devam', result: 'Delist blokajlı' },
      { choice: 'İncelemeye sevk' },
    ],
  },
  'Geçici Blokaj': {
    title: 'Geçici Blokaj', feature: 'MuBlock',
    description: 'Bitiş zamanı dolan blokajı kaldırarak kaydı Normal duruma alın.',
    initial: 'Geçici blokajlı', blockLabel: 'Geçici blokaj',
    fields: [
      { name: 'blockReason', label: 'Blokaj nedeni', type: 'text', max: 500 },
      { name: 'blockEndsAt', label: 'Blokaj bitişi (Türkiye saati)', type: 'datetime-local' },
    ],
    actions: [
      { choice: 'Blokajı kaldır', result: 'Normal', from: ['Geçici blokajlı'], releaseTemporary: true },
    ],
  },
  SKT: {
    title: 'SKT Kontrol', feature: 'MuExpiry',
    description: 'Lotun son kullanma tarihini kontrol edin, riskli ürünü ayırın veya iadeye yönlendirin.',
    initial: 'İnceleme',
    fields: [{ name: 'expiryDate', label: 'Son kullanma tarihi', type: 'date' }],
    actions: [
      { choice: 'Riskli ürünü ayır', result: 'Ayrıldı', requestable: true },
      { choice: 'Depoya iade', result: 'İadeye yönlendirildi', requestable: true },
      { choice: 'İncelemeye sevk', requestable: true },
      { choice: saleApproval, guarded: true, from: ['İnceleme', 'İncelemeye sevk'] },
    ],
  },
  'Depo İade': {
    title: 'Depo İade', feature: 'MuReturn',
    description: 'İade gerekçesini ve miktarını kaydedin, gönderim ve teslim durumunu takip edin.',
    initial: 'İade bekliyor', quantityLabel: 'İade miktarı',
    fields: [{ name: 'returnReason', label: 'İade gerekçesi', type: 'text', max: 500 }],
    actions: [
      { choice: 'İadeyi gönder', result: 'Teslimat bekliyor', from: ['İade bekliyor'] },
      { choice: 'Teslimi kaydet', result: 'Teslim edildi', from: ['Teslimat bekliyor'] },
      { choice: 'İade sorunu bildir', result: 'İade incelemede', from: ['İade bekliyor', 'Teslimat bekliyor'] },
      { choice: 'İadeyi yeniden başlat', result: 'İade bekliyor', from: ['İade incelemede'] },
    ],
  },
  'Depo Fark': {
    title: 'Depo Fark', feature: 'MuDifference',
    description: 'Sistem stoku ile fiziksel sayımı karşılaştırın ve düzeltme talebinin sonucunu kaydedin.',
    initial: 'Sayım farkı',
    fields: [
      { name: 'systemStock', label: 'Sistem stoku', type: 'number' },
      { name: 'physicalStock', label: 'Fiziksel sayım', type: 'number' },
    ],
    actions: [
      { choice: 'Düzeltme talebi oluştur', result: 'Onay bekliyor', from: ['Sayım farkı', 'Düzeltme talebi reddedildi'], requestable: true },
      { choice: 'Düzeltme talebini onayla', result: 'Düzeltme talebi onaylandı', from: ['Onay bekliyor'] },
      { choice: 'Düzeltme talebini reddet', result: 'Düzeltme talebi reddedildi', from: ['Onay bekliyor'] },
    ],
  },
  [display]: {
    title: display, feature: 'MuDisplay Lite', workflow: true,
    description: 'Teşhir alanını, raf yerleşimini ve fiyat etiketini kontrol edin. Kontrolü MuApproval Lite üzerinden incelemeye gönderin.',
    initial: 'Talep açıldı', quantityLabel: 'Teşhir adedi',
    fields: [
      { name: 'displayArea', label: 'Teşhir alanı', type: 'select', options: ['Ana reyon', 'Gondol', 'Kasa önü', 'Kampanya alanı'] },
      { name: 'displayCondition', label: 'Ürün durumu', type: 'select', options: ['Uygun', 'Düzeltme gerekli'] },
      { name: 'displayLabel', label: 'Fiyat etiketi', type: 'select', options: ['Uygun', 'Düzeltme gerekli'] },
      { name: 'displayPlacement', label: 'Raf yerleşimi', type: 'select', options: ['Uygun', 'Düzeltme gerekli'] },
    ],
    actions: [
      { choice: 'Teşhir uygunluğu onayı', result: 'Teşhir uygunluğu onaylandı', requestable: true },
      { choice: 'Teşhir düzeltme talebi', result: 'Teşhir düzeltme talebi onaylandı', requestable: true },
    ],
  },
  [hotSale]: {
    title: hotSale, feature: 'MuHotSale Lite', workflow: true,
    description: 'Pilot katalogda satışa açık ve SKT kaydı doğrulanabilen lotlar için satış önceliği veya kampanya önerisi gönderin. Onay, yetkili ekibe iletilebilecek bir karar kaydı oluşturur.',
    initial: 'Talep açıldı', quantityLabel: 'Önerilen adet',
    fields: [
      { name: 'expiryDate', label: 'Son kullanma tarihi', type: 'date' },
      { name: 'saleCondition', label: 'Fiziksel satış uygunluğu', type: 'select', options: ['Satışa uygun', 'Satışa uygun değil'] },
      { name: 'saleAction', label: 'Satış aksiyonu', type: 'select', options: ['Satış önceliği', 'Kampanya önerisi'] },
    ],
    actions: [
      { choice: 'Satış önceliği', result: 'Satış önceliği onaylandı', requestable: true },
      { choice: 'Kampanya önerisi', result: 'Kampanya önerisi onaylandı', requestable: true },
    ],
  },
  [recipeControl]: {
    title: recipeControl, feature: 'MuRecipe Lite', workflow: true, requiresRecipe: true,
    description: 'MuScan Lite ile reçete kartını açın ve üretim lotunun kontrolünü kaydedin. Üretim ve satışa açma yetkili süreçlerde yürütülür.',
    initial: 'Talep açıldı', quantityLabel: 'Kontrol edilen adet',
    fields: [
      { name: 'ingredientCheck', label: 'Bileşen ve miktar kontrolü', type: 'select', options: recipeChecks },
      { name: 'expiryCheck', label: 'Lot ve SKT kontrolü', type: 'select', options: recipeChecks },
      { name: 'blockCheck', label: 'RKS ve blokaj kontrolü', type: 'select', options: recipeChecks },
      { name: 'allergenCheck', label: 'Reçete ve alerjen kontrolü', type: 'select', options: recipeChecks },
      { name: 'hygieneCheck', label: 'Hijyen kontrolü', type: 'select', options: recipeChecks },
      { name: 'foodSafetyCheck', label: 'Gıda güvenliği kontrolü', type: 'select', options: recipeChecks },
      { name: 'temperatureCheck', label: 'Sıcaklık kontrolü', type: 'select', options: [...recipeChecks, 'Uygulanmaz'] },
    ],
    actions: [
      { choice: recipeCompliance, result: 'Reçete kontrolü onaylandı', requestable: true },
      { choice: 'Reçete uygunsuzluğu incelemesi', result: 'Reçete uygunsuzluğu incelemesi kaydedildi', requestable: true },
    ],
  },
  [crossDock]: {
    title: crossDock, feature: 'MuDock',
    description: 'Doğrudan sevkiyat uygunluğunu değerlendirin ve uygun ürün için varış noktası kaydedin.',
    initial: 'Kontrol bekliyor',
    fields: [{ name: 'dockNote', label: 'Sevkiyat kontrol notu', type: 'text', max: 500 }],
    actions: [
      { choice: 'Sevkiyata uygun', result: 'Sevkiyata uygun', from: ['Kontrol bekliyor', 'Sevkiyata uygun değil'], guarded: true, requestable: true },
      { choice: 'Sevkiyata uygun değil', result: 'Sevkiyata uygun değil', from: ['Kontrol bekliyor', 'Sevkiyata uygun'], requestable: true },
      { choice: 'Sevkiyata yönlendir', result: 'Sevkiyata yönlendirildi', from: ['Sevkiyata uygun'], guarded: true, destination: true },
    ],
  },
};

module.exports = { operations, saleApproval, assessments, crossDock, hotSale, recipeControl, recipeCompliance };
