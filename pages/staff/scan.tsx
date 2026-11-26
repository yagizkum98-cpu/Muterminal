import LanguagePicker, { useLanguage, useTranslate } from '../../components/LanguagePicker';
import ReportDownload from '../../components/ReportDownload';
import ReportTable from '../../components/ReportTable';
import EvidenceFields from '../../components/EvidenceFields';
import { encodeEvidence } from '../../public/mu-evidence.mjs';
import { languageFromCookie } from '../../lib/language';
import { scanReport, type ScanActivity } from '../../lib/report-data';
import { useEffect, useState, type FormEvent } from 'react';
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import { getSession } from '../../server/application';
import { scanEnabled } from '../../server/features';
import { mobileStaffState } from '../../server/mobile-access';
import styles from '../../components/StaffScan.module.css';

interface Props { staff: string; initialBarcode: string; initialLot: string; mobile: boolean }

interface Product {
  id: string; name: string; barcode: string; productCode: string; lot: string;
  expiryDate: string | null; rksBlocked: boolean; expired: boolean; quantity: number | null;
  pending: boolean; example: boolean; choices: string[];
}

interface Lookup { products: Product[]; today: string }
interface Check { expiryDate: string; unreadable: boolean; rks: string; packaging: string; quantity: string }

const steps = ['Barkod', 'Ürün', 'Kontrol', 'Karar', 'Onay'];
const emptyCheck: Check = { expiryDate: '', unreadable: false, rks: '', packaging: '', quantity: '' };
const saleApproval = 'Satılabilir (ön onay)';
const guardedChoices = new Set([saleApproval, 'Cross-Dock Uygun']);
const rksOptions = { clear: 'Kontrol edildi, blokaj görülmedi', blocked: 'Blokaj görüldü', unknown: 'Doğrulanamadı' };
const packagingOptions = { intact: 'Sağlam', damaged: 'Hasarlı', unknown: 'Kontrol edilemedi' };

export const getServerSideProps: GetServerSideProps<Props> = async ({ req, res, query }) => {
  res.setHeader('Cache-Control', 'no-store');
  const session = await getSession(req, 'staff');
  const mobile = query.mobil === '1' || session?.mobile === true;
  if (session && mobile && await mobileStaffState(session) !== 'allowed') {
    return { redirect: { destination: '/mobil', permanent: false } };
  }
  if (!session) {
    return { redirect: { destination: mobile ? '/?panel=staff&mobil=1#admin-giris' : '/?panel=staff#admin-giris', permanent: false } };
  }
  if (!scanEnabled(session)) return { redirect: { destination: mobile ? '/staff?mobil=1#muscan-durum' : '/staff#muscan-durum', permanent: false } };
  if (session.role !== 'staff') {
    return { redirect: { destination: mobile ? '/mobil' : `/${session.role}`, permanent: false } };
  }
  return { props: {
    staff: session.displayName ?? session.email,
    initialBarcode: typeof query.code === 'string' ? query.code.slice(0, 80) : '',
    initialLot: typeof query.lot === 'string' ? query.lot.slice(0, 80) : '',
    mobile, language: languageFromCookie(req.headers.cookie),
  } };
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (response.status === 401) {
    const mobile = new URLSearchParams(window.location.search).get('mobil') === '1';
    window.location.assign(mobile ? '/?panel=staff&mobil=1#admin-giris' : '/?panel=staff#admin-giris');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'İşlem tamamlanamadı.');
  return body as T;
}

export default function StaffScan({ staff, initialBarcode, initialLot, mobile }: Props) {
  const t = useTranslate();
  const language = useLanguage();
  const locale = language === 'en' ? 'en-GB' : 'tr-TR';
  const formatDate = (date: string | null) => date
    ? new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).format(new Date(date)) : t('Kayıt yok');
  const [step, setStep] = useState(0);
  const [barcode, setBarcode] = useState(initialBarcode);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [productId, setProductId] = useState('');
  const [check, setCheck] = useState(emptyCheck);
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [activity, setActivity] = useState<ScanActivity | null>(null);
  const product = lookup?.products.find(item => item.id === productId);
  const canSuggestSale = Boolean(product && lookup && !product.rksBlocked && !product.expired && !check.unreadable &&
    check.expiryDate >= lookup.today && (!product.expiryDate || product.expiryDate === check.expiryDate) &&
    check.rks === 'clear' && check.packaging === 'intact' && Number(check.quantity) > 0 &&
    (product.quantity === null || product.quantity === Number(check.quantity)));
  const choices = product?.choices.filter(value => !guardedChoices.has(value) || canSuggestSale) ?? [];

  useEffect(() => {
    let active = true;
    let timer: number;
    async function refresh() {
      try {
        const items = await request<ScanActivity>('/api/scan/history');
        if (active) { setActivity(items); setHistoryError(''); }
      } catch {
        if (active) setHistoryError('İşlem geçmişi şu anda yüklenemiyor.');
      } finally {
        if (active) timer = window.setTimeout(refresh, 8_000);
      }
    }
    refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  function reset() {
    setStep(0);
    setBarcode('');
    setLookup(null);
    setProductId('');
    setCheck(emptyCheck);
    setChoice('');
    setReason('');
    setError('');
  }

  async function findProduct(example = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await (example
        ? request<Lookup>('/api/scan/example', { method: 'POST' })
        : request<Lookup>(`/api/scan?code=${encodeURIComponent(barcode.trim())}`));
      if (!result.products.length) throw new Error('Bu mağazada barkod veya ürün kodu bulunamadı.');
      setLookup(result);
      if (example) setBarcode(result.products[0].barcode);
      const linkedLot = !example && barcode.trim() === initialBarcode && result.products.find(item => item.lot === initialLot);
      setProductId(linkedLot ? linkedLot.id : result.products.length === 1 ? result.products[0].id : '');
      setCheck(emptyCheck);
      setChoice('');
      setReason('');
      setStep(1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ürün sorgulanamadı.');
    } finally { setBusy(false); }
  }

  function next(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (step === 0) void findProduct();
    else {
      if (step === 2 && !choices.includes(choice)) setChoice('');
      setStep(step + 1);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || !product || !choices.includes(choice)) return;
    const file = document.querySelector<HTMLInputElement>('#scan-evidence-photo')?.files?.[0];
    const category = document.querySelector<HTMLSelectElement>('#scan-evidence-category')?.value ?? '';
    setBusy(true);
    setError('');
    try {
      const evidence = await encodeEvidence(file, category);
      const { requestId } = await request<{ requestId: string }>('/api/scan/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, choice, reason, rks: check.rks, packaging: check.packaging,
          expiryDate: check.unreadable ? null : check.expiryDate, quantity: Number(check.quantity), evidence }),
      });
      window.location.assign(`/manager?talep=${encodeURIComponent(requestId)}${mobile ? '&mobil=1' : ''}#talep-${encodeURIComponent(requestId)}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Talep gönderilemedi.');
      setBusy(false);
    }
  }

  function continueToCheck() {
    if (!product || product.pending) return;
    if (check === emptyCheck) setCheck({ ...emptyCheck, expiryDate: product.expiryDate ?? '' });
    setStep(2);
  }

  return <div className={styles.shell}>
    <Head><title>{t("MuTerminal Scan | Personel")}</title></Head>
    <header className={styles.header}>
      <div className={styles.wrap}>
        <div><h1>MuTerminal Scan</h1><p>{staff}{" " + t("· Personel paneli")}</p></div>
        <nav aria-label={t("Personel bağlantıları")}>
          <LanguagePicker />
          {mobile && <a href="/mobil">{t("Mobil ana ekran")}</a>}
          <a href={mobile ? '/staff?mobil=1' : '/staff'}>{t("Core kayıtları")}</a>
          <a href={product ? `/trace?code=${encodeURIComponent(product.barcode)}&lot=${encodeURIComponent(product.lot)}${mobile ? '&mobil=1' : ''}`
            : mobile ? '/trace?mobil=1' : '/trace'}>MU TRACE</a><a href="#islem-gecmisim">{t("İşlem geçmişim")}</a>
          <form method="post" action={mobile ? '/admin/logout?mobil=1' : '/admin/logout'}><button type="submit">{t("Oturumu kapat")}</button></form>
        </nav>
      </div>
    </header>
    <main className={`${styles.wrap} ${styles.main}`}>
      <section className={styles.card} aria-labelledby="scan-title">
        <div className={styles.cardHeading}>
          <div><h2 id="scan-title">{t("Ürün kontrolü")}</h2><p>{t("Ürünü sorgulayın, lotu doğrulayın ve talebi yöneticiye gönderin.")}</p></div>
          <button type="button" disabled={busy} onClick={reset}>{t("Sıfırla")}</button>
        </div>
        <ol className={styles.steps} aria-label={t("Dijital işlem akışı")}>
          {steps.map((label, index) => <li key={label} data-complete={index < step} aria-current={step === index ? 'step' : undefined}>{t(label)}</li>)}
        </ol>
        {error && <p className={styles.error} role="alert">{t(error)}</p>}
        <div className={styles.flow} key={step}>
          {step === 0 && <form onSubmit={next}>
            <label htmlFor="scan-barcode">{t("Barkod veya ürün kodu")}</label>
            <div className={styles.lookup}>
              <input id="scan-barcode" name="code" value={barcode} onChange={event => setBarcode(event.target.value)} maxLength={80} autoComplete="off" placeholder="8690000000011" autoFocus required />
              <button className={styles.primary} type="submit" disabled={busy}>{busy ? t("Sorgulanıyor…") : t("Ürünü sorgula")}</button>
            </div>
            <p className={styles.muted}>{t("Barkod okuyucuyla okutun veya kodu elle girin.")}</p>
            <button type="button" onClick={() => void findProduct(true)} disabled={busy}>{t("Örnek süt senaryosunu aç")}</button>
          </form>}
          {step === 1 && <div>
            <label htmlFor="scan-lot">{t("Ürün ve lot")}</label>
            <select id="scan-lot" value={productId} onChange={event => { setProductId(event.target.value); setCheck(emptyCheck); setChoice(''); setReason(''); }}>
              <option value="">{t("Lot seçin")}</option>
              {lookup?.products.map(option => <option value={option.id} key={option.id}>{option.name} · {option.lot}</option>)}
            </select>
            {product && <>
              <h3>{product.name} {product.example && <small className={styles.badge}>{t("Örnek kayıt")}</small>}</h3>
              <dl className={styles.details}>
                <div><dt>{t("Barkod")}</dt><dd>{product.barcode}</dd></div><div><dt>{t("Ürün kodu")}</dt><dd>{product.productCode}</dd></div>
                <div><dt>{t("Lot")}</dt><dd>{product.lot}</dd></div><div><dt>{t("SKT")}</dt><dd>{formatDate(product.expiryDate)}{product.expired && ' ' + t('· Geçmiş')}</dd></div>
                <div><dt>{t("RKS durumu")}</dt><dd>{t(product.rksBlocked ? "Blokajlı" : 'Kontrol gerekli')}</dd></div><div><dt>{t("Karar yetkisi")}</dt><dd>{t("Yönetici onayı")}</dd></div>
              </dl>
              {product.pending && <p className={styles.notice}>{t("Bu lot için yönetici onayı bekleyen bir talep var.")}</p>}
            </>}
            <button className={styles.primary} type="button" disabled={!product || product.pending} onClick={continueToCheck}>{t("Kontrole geç")}</button>
          </div>}
          {step === 2 && product && <form onSubmit={next}>
            <h3>{t("Kontrol formu")}</h3>
            <div className={styles.fields}>
              <div><label htmlFor="scan-expiry">{t("Ürün üzerindeki SKT")}</label><input id="scan-expiry" type="date" value={check.expiryDate} disabled={check.unreadable} required={!check.unreadable} onChange={event => setCheck({ ...check, expiryDate: event.target.value })} />
                <label className={styles.inline}><input type="checkbox" checked={check.unreadable} onChange={event => setCheck({ ...check, unreadable: event.target.checked })} />{" " + t("SKT okunamadı")}</label>
              </div>
              <div><label htmlFor="scan-rks">{t("RKS kontrolü")}</label><select id="scan-rks" value={check.rks} onChange={event => setCheck({ ...check, rks: event.target.value })} required>
                <option value="">{t("Sonuç seçin")}</option>{Object.entries(rksOptions).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select></div>
              <div><label htmlFor="scan-packaging">{t("Ambalaj kontrolü")}</label><select id="scan-packaging" value={check.packaging} onChange={event => setCheck({ ...check, packaging: event.target.value })} required>
                <option value="">{t("Sonuç seçin")}</option>{Object.entries(packagingOptions).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select></div>
              <div><label htmlFor="scan-quantity">{t("Sayılan miktar") + " "}{product.quantity !== null ? t('(kayıtlı {quantity})', { quantity: product.quantity }) : ''}</label>
                <input id="scan-quantity" type="number" min={0} step={1} value={check.quantity} onChange={event => setCheck({ ...check, quantity: event.target.value })} required />
              </div>
            </div>
            <button className={styles.primary} type="submit">{t("Karar önerisine geç")}</button>
          </form>}
          {step === 3 && <form onSubmit={next}>
            <h3>{t("MuDecision önerisi")}</h3>
            <label htmlFor="scan-choice">{t("Karar önerisi")}</label>
            <select id="scan-choice" value={choice} onChange={event => setChoice(event.target.value)} required>
              <option value="">{t("Karar seçin")}</option>{choices.map(option => <option key={option} value={option}>{t(option)}</option>)}
            </select>
            {!choices.includes(saleApproval) && <p className={styles.notice}>{t("Mevcut kayıtlar ve kontrol sonuçları satış ön onayı için uygun görünmüyor.")}</p>}
            <label htmlFor="scan-reason">{t("Karar gerekçesi")}</label>
            <textarea id="scan-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} required />
            <button className={styles.primary} type="submit" disabled={!reason.trim()}>{t("Gönderimi incele")}</button>
          </form>}
          {step === 4 && product && <form onSubmit={send}>
            <h3>{t("Yönetici onayına gönder")}</h3>
            <dl className={styles.details}>
              <div><dt>{t("Ürün ve lot")}</dt><dd>{product.name} · {product.lot}</dd></div><div><dt>{t("Öneri")}</dt><dd>{t(choice)}</dd></div>
              <div><dt>{t("SKT ve miktar")}</dt><dd>{check.unreadable ? t("Okunamadı") : formatDate(check.expiryDate)} · {check.quantity}{" " + t("adet")}</dd></div>
              <div><dt>{t("RKS ve ambalaj")}</dt><dd>{t(rksOptions[check.rks as keyof typeof rksOptions])} · {t(packagingOptions[check.packaging as keyof typeof packagingOptions])}</dd></div>
              <div className={styles.reason}><dt>{t("Gerekçe")}</dt><dd>{reason}</dd></div>
            </dl>
            <EvidenceFields prefix="scan" />
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? t("Gönderiliyor…") : t("Yöneticiye gönder")}</button>
          </form>}
          {step > 0 && <button type="button" className={styles.back} disabled={busy} onClick={() => { setError(''); setStep(step - 1); }}>{t("Önceki adım")}</button>}
        </div>
        <p className={styles.safety}>{t("Personel kararı öneridir. Satışa açma ve RKS blokajının kaldırılması yetkili sistemlerde doğrulanır.")}</p>
      </section>
      <section className={`${styles.card} ${styles.history}`} id="islem-gecmisim" aria-labelledby="scan-history-title">
        <h2 id="scan-history-title">{t("İşlem geçmişim")}</h2>
        {historyError && <p className={styles.error} role="status">{t(historyError)}</p>}
        {activity ? <>
          <ReportDownload getReport={language => scanReport(activity, language)} />
          {scanReport(activity, language).sections.map(section => <div key={section.key}>
            <h3 id={`scan-report-${section.key}`}>{section.title}</h3>
            <ReportTable section={section} labelledBy={`scan-report-${section.key}`} />
          </div>)}
        </> : <p>{t(historyError ? 'Yeniden deneniyor…' : 'Kayıtlar yükleniyor…')}</p>}
      </section>
    </main>
  </div>;
}
