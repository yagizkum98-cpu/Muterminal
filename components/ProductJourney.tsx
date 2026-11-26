import { useTranslate } from './LanguagePicker';
import { useEffect, useState } from 'react';
import styles from './ProductJourney.module.css';

const stages = [
  {
    id: 'lookup', label: 'Barkod', modules: ['MuScan Lite'],
    title: 'Barkodla ürün bulunur',
    summary: 'Personel süt kolisinin barkodunu okutur. MuScan Lite eşleşen ürünü ve mağazadaki kontrol kayıtlarını açar.',
    fields: [['Ürün', 'Süt 1 L'], ['Barkod', '8690000000011']], next: 'Ürün kartını gör',
  },
  {
    id: 'catalog', label: 'Ürün kartı', modules: ['MuProduct', 'MuStock Lite'],
    title: 'Ürün kartı ve kaynak stok incelenir',
    summary: 'Ürün kartındaki koli içi miktar ve depodan alınan son stok bilgisi görüntülenir.',
    fields: [['Koli içi miktar', '12 adet'], ['Depo kodu', '0001'], ['Kaynak stok', '12 adet']], next: 'Ürün kontrolüne geç',
  },
  {
    id: 'check', label: 'Kontrol', modules: ['MuExpiry', 'MuEvidence'],
    title: 'Lot, SKT ve fotoğraf kaydedilir',
    summary: 'Personel lotu ve son kullanma tarihini kaydeder. Hasarlı ambalajın fotoğrafını kontrol kaydına ekler.',
    fields: [['Lot', 'A-214'], ['SKT', '04.12.2026'], ['Kanıt türü', 'Hasarlı ambalaj']], next: 'MuDecision’a geç',
  },
  {
    id: 'decision', label: 'Karar talebi', modules: ['MuDecision'],
    title: 'Personel gerekçeli inceleme talebi gönderir',
    summary: 'Personel, A-214 lotunun karar dosyasında ambalaj hasarını gerekçe göstererek inceleme talebi oluşturur.',
    fields: [['Karar önerisi', 'İncelemede'], ['Gerekçe', 'Ambalaj hasarı incelenecek.']], next: 'Yönetici kararını gör',
  },
  {
    id: 'approval', label: 'Yönetici onayı', modules: ['MuApproval Lite'],
    title: 'Yönetici talebi değerlendirir',
    summary: 'Yönetici kontrol kaydını ve fotoğrafı inceler. Bu örnekte lotun incelemede kalmasını gerekçesiyle onaylar.',
    fields: [['Sonuç', 'Onaylandı · İncelemede'], ['Yönetici gerekçesi', 'Ambalaj kontrolü tamamlanana kadar incelemede kalsın.']], next: 'Karar geçmişini gör',
  },
  {
    id: 'history', label: 'Geçmiş', modules: ['MuLog', 'MuTrace Lite'],
    title: 'Karar ürün geçmişinde izlenir',
    summary: 'Kontrol, talep ve yönetici onayı geçmişe işlenir. Yetkili kullanıcı ürünün kararlarını lotlar arasında inceleyebilir.',
    fields: [['Lot', 'A-214'], ['Ürün karar geçmişi', 'Kontrol kaydı, inceleme talebi ve yönetici onayı']], next: 'Baştan başlat',
  },
] as const;

type Stage = (typeof stages)[number];
const lastStage = stages.length - 1;
const playbackDelay = 5_000;

function RecordPreview({ stage, position }: { stage: Stage; position: number }) {
  const t = useTranslate();
  return <div className={styles.recordPreview}>
    <div className={styles.recordHeader}>
      <span>{t('Örnek kayıt')}</span>
      <strong>{stage.modules.join(' · ')}</strong>
    </div>
    <dl className={styles.details} key={stage.id}>
      {stage.fields.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{t(value)}</dd></div>)}
    </dl>
    <progress className={styles.progress} max={stages.length} value={position + 1} aria-hidden="true" />
  </div>;
}

export default function ProductJourney() {
  const t = useTranslate();
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stage = stages[position];

  useEffect(() => {
    if (!playing || position === lastStage) return;
    const timer = window.setTimeout(() => {
      const next = position + 1;
      setPosition(next);
      if (next === lastStage) setPlaying(false);
    }, playbackDelay);
    return () => window.clearTimeout(timer);
  }, [playing, position]);

  function selectStage(index: number) {
    setPlaying(false);
    setPosition(index);
  }

  function togglePlayback() {
    if (position === lastStage) setPosition(0);
    setPlaying(!playing);
  }

  return <section className={`wrap ${styles.section}`} id="urun-akisi" aria-labelledby="product-journey-title">
    <div className={styles.card}>
      <header className={styles.header}>
        <h2 id="product-journey-title">{t("Bir ürünün depo yolculuğu")}</h2>
        <p>{t("Örnek bir süt kolisini barkod sorgusundan yönetici onayına ve ürün geçmişine kadar takip edin.")}</p>
      </header>
      <div className={styles.layout} aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
        <RecordPreview position={position} stage={stage} />
        <div className={styles.story}>
          <div className={styles.chapter} key={stage.id}>
            <p className={styles.counter}>{t("Adım") + " "}{position + 1} / {stages.length}</p>
            <h3>{t(stage.title)}</h3>
            <p>{t(stage.summary)}</p>
          </div>
        </div>
      </div>
      <ol className={styles.steps} aria-label={t("Ürün kontrol akışı adımları")}>
        {stages.map((item, index) => <li key={item.id}>
          <button type="button" aria-current={index === position ? 'step' : undefined} onClick={() => selectStage(index)}>{t(item.label)}</button>
        </li>)}
      </ol>
      <div className={styles.controls}>
        <button type="button" onClick={togglePlayback}>{playing ? t("Duraklat") : t("Oynat")}</button>
        <div className={styles.navigation}>
          <button type="button" disabled={position === 0} onClick={() => selectStage(position - 1)}>{t("Önceki")}</button>
          <button type="button" className={styles.primary} onClick={() => selectStage(position === lastStage ? 0 : position + 1)}>{t(stage.next)}</button>
        </div>
      </div>
    </div>
  </section>;
}
