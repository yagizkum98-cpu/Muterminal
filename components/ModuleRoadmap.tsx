import { useTranslate } from './LanguagePicker';

type Module = { name: string; description: string; href?: string; status?: string; available?: boolean };
type ModuleGroup = { title?: string; modules: Module[] };

const pilotGroups: ModuleGroup[] = [
  {
    title: 'MuTerminal CORE',
    modules: [
      { name: 'MuBlock', description: 'RKS, delist ve geçici blokaj takibi' },
      { name: 'MuExpiry', description: 'Lot ve son kullanma tarihi kontrolü' },
      { name: 'MuReturn', description: 'Depo iadesi ve teslim takibi' },
      { name: 'MuDifference', description: 'Fiziksel sayım ve stok farkı kaydı' },
      { name: 'MuDecision', description: 'Ürün ve lot bazında karar dosyası' },
      { name: 'MuLog', description: 'Gerekçeli karar geçmişi ve raporlar' },
      { name: 'MuDisplay Lite', description: 'Teşhir alanı, raf kontrol listesi, fotoğraf ve yönetici incelemesi' },
      { name: 'MuHotSale Lite', description: 'Lot uygunluğu kontrolü, satış önceliği ve kampanya önerisi' },
      { name: 'MuRecipe Lite', description: 'Reçeteli ürün işareti, reçete kartı ve üretim kontrol kaydı' },
    ],
  },
  {
    title: 'Pilot destek modülleri',
    modules: [
      { name: 'MuScan Lite', description: 'Barkod ve ürün koduyla sorgulama' },
      { name: 'MuProduct', description: 'Ürün kartı, fiyat ve koli bilgisi' },
      { name: 'MuStock Lite', description: 'Depo bazında kaynak stok kayıtları' },
      { name: 'MuSync Lite', description: 'Mağaza bazında katalog ve stok CSV aktarımı' },
      { name: 'MuApproval Lite', description: 'Yönetici onayı, ret ve ek kontrol' },
      { name: 'MuEvidence', description: 'Kontrol ve karar taleplerinde fotoğraflı kanıt' },
      { name: 'MuDashboard Lite', description: 'Pilot metrikleri, bekleyen onaylar ve SKT riskleri' },
      { name: 'MuTrace Lite', description: 'Ürünün lotlar arası karar geçmişi' },
    ],
  },
  {
    title: 'İzlenebilirlik ve mobil',
    modules: [
      { name: 'MU TRACE', description: 'Ürün hareketleri, lot takibi ve geri çağırma', href: '/trace' },
      { name: 'MU TRACE Mobil', description: 'Mobil barkod sorgulama ve saha kontrolleri', href: '/mobil' },
    ],
  },
];

function ModuleEntries({ modules, mobile = false }: { modules: Module[]; mobile?: boolean }) {
  const t = useTranslate();
  return <ul className="roadmap-module-list">
    {modules.map(({ name, description, href, status, available }) => <li key={name}>
      <div className="roadmap-module-name">
        {href ? <a href={mobile && href === '/trace' ? `${href}?mobil=1` : href}>{name}</a> : <strong>{t(name)}</strong>}
        {status && <span className="roadmap-status" data-available={available || undefined}>{t(status)}</span>}
      </div>
      <p>{t(description)}</p>
    </li>)}
  </ul>;
}

export default function ModuleRoadmap({ scanAvailable, dockAvailable, mobile }: {
  scanAvailable: boolean; dockAvailable: boolean; mobile: boolean;
}) {
  const t = useTranslate();
  const development: Module[] = [
    {
      name: 'MuScan', status: scanAvailable ? 'Etkin' : 'Tester erişimi', available: scanAvailable,
      description: 'Fiziksel ürün kontrolü ve gerekçeli karar talebi. Personel erişimi saha prosedürleriyle yaygınlaştırılır.',
    },
    {
      name: 'MuSync · ERP/WMS', status: 'Pilot altyapısı',
      description: 'CSV aktarımı ve kaynak stok kayıtları üzerine yetkili API bağlantısı planlanıyor.',
    },
    {
      name: 'MuAnalytics Lite', status: 'Planlanan',
      description: 'Yetkili satış ve stok verisiyle satış hızı ve stok eğilimi analizi.',
    },
    { name: 'MuDisplay', status: 'Planlanan', description: 'Teşhir görevleri, bildirimler ve raf kontrolleri.' },
    { name: 'MuHotSale', status: 'Planlanan', description: 'Satış hızı ve stok verisine dayalı kampanya önerileri.' },
    { name: 'MuRecipe', status: 'Planlanan', description: 'Bileşen, miktar, lot ve SKT doğrulama.' },
  ];
  const operations: Module[] = [
    {
      name: 'MuDock · Cross-Dock', status: dockAvailable ? 'Etkin' : 'Prototip · Pilot dışında', available: dockAvailable,
      description: 'Sevkiyat uygunluğu, varış noktası ve onay kaydı. Depo verisiyle doğrulama hedefleniyor.',
    },
    { name: 'MuWarehouse', status: 'Planlanan', description: 'Depo lokasyonları, kabul ve stok hareketlerinin takibi.' },
    { name: 'MuTransfer', status: 'Planlanan', description: 'Mağaza ve depolar arası transfer talebi, sevkiyat ve teslim takibi.' },
    { name: 'MuDisplay Analytics', status: 'Planlanan', description: 'Mağaza ve teşhir performansı analizi.' },
    { name: 'MuProduction', status: 'Planlanan', description: 'Üretim emirleri, reçete sürümleri, fire ve stok entegrasyonu.' },
  ];
  const phases: { title: string; period: string; overview: string; groups: ModuleGroup[] }[] = [
    { title: 'Mağaza pilotu', period: '0–3 ay',
      overview: 'Mağaza ekiplerinin kullanabildiği kontrol, onay ve kayıt modülleri.', groups: pilotGroups },
    { title: 'Saha kullanımı ve entegrasyon', period: '3–6 ay',
      overview: 'Saha kontrollerini yaygınlaştırma ve yetkili kaynaklarla veri alışverişi.', groups: [{ modules: development }] },
    { title: 'Depo ve lojistik', period: '6–12 ay',
      overview: 'MuTerminal Operations ile depo, sevkiyat ve transfer süreçlerine genişleme.', groups: [{ modules: operations }] },
    { title: 'Satış ve üretim zekâsı', period: '12–24 ay',
      overview: 'Talep tahmini ve üretim risklerinin analizi.', groups: [{ modules: [
        { name: 'MuHotSale AI', status: 'Planlanan', description: 'Talep tahmini ve satış aksiyonu önerileri.' },
        { name: 'MuRecipe AI', status: 'Planlanan', description: 'Reçete sapmaları ve üretim risklerine yönelik öneriler.' },
      ] }] },
  ];

  return <section className="wrap modules-overview" id="moduller" aria-labelledby="modules-title">
    <h2 id="modules-title">{t('MuTerminal modülleri')}</h2>
    <nav className="roadmap-nav" aria-label={t('Ürün yol haritası')}>
      {phases.map(({ title }, index) => <a key={title} href={`#asama-${index + 1}`}>
        <span>{t('Aşama {number}', { number: index + 1 })}</span>
        <strong>{t(title)}</strong>
      </a>)}
    </nav>
    {phases.map(({ title, period, overview, groups }, index) => <section className="roadmap-phase" key={title}
      id={`asama-${index + 1}`} aria-labelledby={`asama-${index + 1}-title`}>
      <header className="roadmap-phase-heading">
        <p className="roadmap-period">{t('Aşama {number}', { number: index + 1 })} · {t(period)}</p>
        <h3 id={`asama-${index + 1}-title`}>{t(title)}</h3>
        <p>{t(overview)}</p>
      </header>
      <div className={groups.length > 1 ? 'roadmap-groups' : 'roadmap-track'}>
        {groups.map(group => <div className="roadmap-group" key={group.title ?? title}>
          {group.title && <h4>{t(group.title)}</h4>}
          <ModuleEntries modules={group.modules} mobile={mobile} />
        </div>)}
      </div>
    </section>)}
  </section>;
}
