import { useTranslate } from './LanguagePicker';
import { useEffect, useState, type CSSProperties } from 'react';
import styles from './ProductJourney.module.css';

const stages = [
  {
    id: 'intake', label: 'Ürün girişi', title: 'Barkodla ürün kaydı açılır',
    summary: 'Süt kolisinin barkodu okutulur. Ürün, Süt reyonu ve teslim alınan adetle birlikte kayda girer.',
    detail: ['Ürün', 'Süt 1 L · 12 adet'], next: 'Lotu kayda bağla',
  },
  {
    id: 'lot', label: 'Lot ve SKT', title: 'Lot ve SKT ürünle eşleştirilir',
    summary: 'Koli üzerindeki lot kodu ve son kullanma tarihi işlenir. Aynı barkodun farklı lotları ayrı ayrı izlenir.',
    detail: ['Lot', 'A-214 · SKT kontrolü gerekli'], next: 'Depo kontrolüne geç',
  },
  {
    id: 'warehouse', label: 'Depo kontrolü', title: 'Depodaki konum ve adet kontrol edilir',
    summary: 'Örnek depoda B-02 rafı kontrol edilir. Kayıttaki 12 adetle fiziksel sayımdaki 12 adet karşılaştırılır.',
    detail: ['Raf B-02', '12 kayıtlı · 12 sayılan'], next: 'MuDecision’a geç',
  },
  {
    id: 'decision', label: 'MuDecision', title: 'Ürün ve lot için karar verilir',
    summary: 'Personel, lot ve sayım bilgilerini aynı karar dosyasında görür. SKT ayrıca doğrulanacağı için bu lotu gerekçesiyle incelemeye gönderir.',
    detail: ['Karar önerisi', 'İncelemede · SKT doğrulanacak'], next: 'Yönlendirmeyi gör',
  },
  {
    id: 'route', label: 'Yönlendirme', title: 'Koli inceleme alanına yönlendirilir',
    summary: 'Yönetici talebi değerlendirir. Lot, örnek senaryoda inceleme alanına alınır ve karar ürün geçmişine işlenir.',
    detail: ['Hedef', 'İnceleme alanı'], next: 'Baştan başlat',
  },
] as const;

type Stage = (typeof stages)[number];
const lastStage = stages.length - 1;
const playbackDelay = 5_000;

function Scene({ stage, position }: { stage: Stage; position: number }) {
  const t = useTranslate();
  return <div className={styles.scene} data-stage={stage.id} aria-hidden="true">
    <div className={styles.sceneHeader}>
      <span>{t("ÖRNEK DEPO")}</span>
      <span>{stage.id === 'intake' ? t("SÜT 1 L") : 'LOT A-214'}</span>
    </div>
    <div className={styles.floor}>
      <div key={stage.id} className={styles.station}>
        {stage.id === 'intake' && <div className={styles.terminal}><span /><i /></div>}
        {stage.id === 'lot' && <div className={styles.tag}><strong>A-214</strong><span>{t("LOT / SKT")}</span></div>}
        {stage.id === 'warehouse' && <div className={styles.shelf}>
          <strong>B-02</strong><span /><span /><span /><span />
        </div>}
        {stage.id === 'decision' && <div className={styles.checklist}>
          <strong>MuDecision</strong><span>{t("Lot kaydı")}</span><span>{t("SKT inceleme")}</span>
        </div>}
        {stage.id === 'route' && <div className={styles.door}><strong>{t("İNCELEME")}</strong><span /></div>}
      </div>
      <div className={styles.parcel}><span>{t("SÜT")}</span><i /></div>
    </div>
    <div className={styles.track} style={{ '--travel': `${position / lastStage * 100}%` } as CSSProperties}>
      <span className={styles.trackProgress} />
      {stages.map((item, index) => <i key={item.id} data-completed={index <= position} />)}
      <span className={styles.tracker} />
    </div>
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
        <p>{t("Örnek bir süt kolisini kayıttan depo yönlendirmesine kadar takip edin.")}</p>
      </header>
      <div className={styles.layout}>
        <Scene position={position} stage={stage} />
        <div className={styles.story} aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
          <div className={styles.chapter} key={stage.id}>
            <p className={styles.counter}>{t("Adım") + " "}{position + 1} / {stages.length}</p>
            <h3>{t(stage.title)}</h3>
            <p>{t(stage.summary)}</p>
            <dl className={styles.details}><dt>{t(stage.detail[0])}</dt><dd>{t(stage.detail[1])}</dd></dl>
          </div>
        </div>
      </div>
      <ol className={styles.steps} aria-label={t("Depo akışı adımları")}>
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
