const crossDock = 'Cross-Dock';
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

module.exports = { operations, saleApproval, assessments, crossDock };
