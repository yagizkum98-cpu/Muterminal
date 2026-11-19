import { useEffect, useState, type FormEvent } from 'react';
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import { getSession } from '../../server/application';
import { scanEnabled } from '../../server/features';
import styles from '../../components/StaffScan.module.css';

interface Props { staff: string }

interface Product {
  id: string; name: string; barcode: string; productCode: string; lot: string;
  expiryDate: string | null; rksBlocked: boolean; expired: boolean; quantity: number | null;
  pending: boolean; example: boolean; choices: string[];
}

interface Lookup { products: Product[]; today: string }
interface Check { expiryDate: string; unreadable: boolean; rks: string; packaging: string; quantity: string }
interface RequestRow {
  requestId: string; name: string; barcode: string; lot: string; choice: string;
  status: 'pending' | 'approved' | 'rejected'; time: string; reason: string; reviewReason: string | null;
}
interface History { pending: RequestRow[]; history: RequestRow[] }

const steps = ['Barkod', 'Ürün', 'Kontrol', 'Karar', 'Onay'];
const emptyCheck: Check = { expiryDate: '', unreadable: false, rks: '', packaging: '', quantity: '' };
const saleApproval = 'Satılabilir (ön onay)';
const guardedChoices = new Set([saleApproval, 'Cross-Dock Uygun']);
const requestStatus = { pending: 'Onay bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi' };
const rksOptions = { clear: 'Kontrol edildi, blokaj görülmedi', blocked: 'Blokaj görüldü', unknown: 'Doğrulanamadı' };
const packagingOptions = { intact: 'Sağlam', damaged: 'Hasarlı', unknown: 'Kontrol edilemedi' };
const dateTime = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });

export const getServerSideProps: GetServerSideProps<Props> = async ({ req, res }) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!scanEnabled()) return { redirect: { destination: '/staff#muscan-durum', permanent: false } };
  const session = await getSession(req);
  if (session?.role !== 'staff') {
    return { redirect: { destination: session ? `/${session.role}` : '/?panel=staff#admin-giris', permanent: false } };
  }
  return { props: { staff: session.displayName ?? session.email } };
};

function formatDate(date: string | null) {
  return date ? date.split('-').reverse().join('.') : 'Kayıt yok';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (response.status === 401) window.location.assign('/?panel=staff#admin-giris');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'İşlem tamamlanamadı.');
  return body as T;
}

export default function StaffScan({ staff }: Props) {
  const [step, setStep] = useState(0);
  const [barcode, setBarcode] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [productId, setProductId] = useState('');
  const [check, setCheck] = useState(emptyCheck);
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [activity, setActivity] = useState<History | null>(null);
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
        const items = await request<History>('/api/scan/history');
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
      setProductId(result.products.length === 1 ? result.products[0].id : '');
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
    setBusy(true);
    setError('');
    try {
      const { requestId } = await request<{ requestId: string }>('/api/scan/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, choice, reason, rks: check.rks, packaging: check.packaging,
          expiryDate: check.unreadable ? null : check.expiryDate, quantity: Number(check.quantity) }),
      });
      window.location.assign(`/manager?talep=${encodeURIComponent(requestId)}#talep-${encodeURIComponent(requestId)}`);
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
    <Head><title>MuTerminal Scan | Personel</title></Head>
    <header className={styles.header}>
      <div className={styles.wrap}>
        <div><h1>MuTerminal Scan</h1><p>{staff} · Personel paneli</p></div>
        <nav aria-label="Personel bağlantıları">
          <a href="/staff">Core kayıtları</a><a href="#islem-gecmisim">İşlem geçmişim</a>
          <form method="post" action="/admin/logout"><button type="submit">Oturumu kapat</button></form>
        </nav>
      </div>
    </header>
    <main className={`${styles.wrap} ${styles.main}`}>
      <section className={styles.card} aria-labelledby="scan-title">
        <div className={styles.cardHeading}>
          <div><h2 id="scan-title">Ürün kontrolü</h2><p>Ürünü sorgulayın, lotu doğrulayın ve talebi yöneticiye gönderin.</p></div>
          <button type="button" disabled={busy} onClick={reset}>Sıfırla</button>
        </div>
        <ol className={styles.steps} aria-label="Dijital işlem akışı">
          {steps.map((label, index) => <li key={label} data-complete={index < step} aria-current={step === index ? 'step' : undefined}>{label}</li>)}
        </ol>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.flow} key={step}>
          {step === 0 && <form onSubmit={next}>
            <label htmlFor="scan-barcode">Barkod veya ürün kodu</label>
            <div className={styles.lookup}>
              <input id="scan-barcode" name="code" value={barcode} onChange={event => setBarcode(event.target.value)} maxLength={80} autoComplete="off" placeholder="8690000000011" autoFocus required />
              <button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Sorgulanıyor…' : 'Ürünü sorgula'}</button>
            </div>
            <p className={styles.muted}>Barkod okuyucuyla okutun veya kodu elle girin.</p>
            <button type="button" onClick={() => void findProduct(true)} disabled={busy}>Örnek süt senaryosunu aç</button>
          </form>}
          {step === 1 && <div>
            <label htmlFor="scan-lot">Ürün ve lot</label>
            <select id="scan-lot" value={productId} onChange={event => { setProductId(event.target.value); setCheck(emptyCheck); setChoice(''); setReason(''); }}>
              <option value="">Lot seçin</option>
              {lookup?.products.map(option => <option value={option.id} key={option.id}>{option.name} · {option.lot}</option>)}
            </select>
            {product && <>
              <h3>{product.name} {product.example && <small className={styles.badge}>Örnek kayıt</small>}</h3>
              <dl className={styles.details}>
                <div><dt>Barkod</dt><dd>{product.barcode}</dd></div><div><dt>Ürün kodu</dt><dd>{product.productCode}</dd></div>
                <div><dt>Lot</dt><dd>{product.lot}</dd></div><div><dt>SKT</dt><dd>{formatDate(product.expiryDate)}{product.expired ? ' · Geçmiş' : ''}</dd></div>
                <div><dt>RKS durumu</dt><dd>{product.rksBlocked ? 'Blokajlı' : 'Kontrol gerekli'}</dd></div><div><dt>Karar yetkisi</dt><dd>Yönetici onayı</dd></div>
              </dl>
              {product.pending && <p className={styles.notice}>Bu lot için yönetici onayı bekleyen bir talep var.</p>}
            </>}
            <button className={styles.primary} type="button" disabled={!product || product.pending} onClick={continueToCheck}>Kontrole geç</button>
          </div>}
          {step === 2 && product && <form onSubmit={next}>
            <h3>Kontrol formu</h3>
            <div className={styles.fields}>
              <div><label htmlFor="scan-expiry">Ürün üzerindeki SKT</label><input id="scan-expiry" type="date" value={check.expiryDate} disabled={check.unreadable} required={!check.unreadable} onChange={event => setCheck({ ...check, expiryDate: event.target.value })} />
                <label className={styles.inline}><input type="checkbox" checked={check.unreadable} onChange={event => setCheck({ ...check, unreadable: event.target.checked })} /> SKT okunamadı</label>
              </div>
              <div><label htmlFor="scan-rks">RKS kontrolü</label><select id="scan-rks" value={check.rks} onChange={event => setCheck({ ...check, rks: event.target.value })} required>
                <option value="">Sonuç seçin</option>{Object.entries(rksOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></div>
              <div><label htmlFor="scan-packaging">Ambalaj kontrolü</label><select id="scan-packaging" value={check.packaging} onChange={event => setCheck({ ...check, packaging: event.target.value })} required>
                <option value="">Sonuç seçin</option>{Object.entries(packagingOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></div>
              <div><label htmlFor="scan-quantity">Sayılan miktar {product.quantity !== null ? `(kayıtlı ${product.quantity})` : ''}</label>
                <input id="scan-quantity" type="number" min={0} step={1} value={check.quantity} onChange={event => setCheck({ ...check, quantity: event.target.value })} required />
              </div>
            </div>
            <button className={styles.primary} type="submit">Karar önerisine geç</button>
          </form>}
          {step === 3 && <form onSubmit={next}>
            <h3>MuDecision önerisi</h3>
            <label htmlFor="scan-choice">Karar önerisi</label>
            <select id="scan-choice" value={choice} onChange={event => setChoice(event.target.value)} required>
              <option value="">Karar seçin</option>{choices.map(option => <option key={option}>{option}</option>)}
            </select>
            {!choices.includes(saleApproval) && <p className={styles.notice}>Mevcut kayıtlar ve kontrol sonuçları satış ön onayı için uygun görünmüyor.</p>}
            <label htmlFor="scan-reason">Karar gerekçesi</label>
            <textarea id="scan-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} required />
            <button className={styles.primary} type="submit" disabled={!reason.trim()}>Gönderimi incele</button>
          </form>}
          {step === 4 && product && <form onSubmit={send}>
            <h3>Yönetici onayına gönder</h3>
            <dl className={styles.details}>
              <div><dt>Ürün ve lot</dt><dd>{product.name} · {product.lot}</dd></div><div><dt>Öneri</dt><dd>{choice}</dd></div>
              <div><dt>SKT ve miktar</dt><dd>{check.unreadable ? 'Okunamadı' : formatDate(check.expiryDate)} · {check.quantity} adet</dd></div>
              <div><dt>RKS ve ambalaj</dt><dd>{rksOptions[check.rks as keyof typeof rksOptions]} · {packagingOptions[check.packaging as keyof typeof packagingOptions]}</dd></div>
              <div className={styles.reason}><dt>Gerekçe</dt><dd>{reason}</dd></div>
            </dl>
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Gönderiliyor…' : 'Yöneticiye gönder'}</button>
          </form>}
          {step > 0 && <button type="button" className={styles.back} disabled={busy} onClick={() => { setError(''); setStep(step - 1); }}>Önceki adım</button>}
        </div>
        <p className={styles.safety}>Personel kararı öneridir. Satışa açma ve RKS blokajının kaldırılması yetkili sistemlerde doğrulanır.</p>
      </section>
      <section className={`${styles.card} ${styles.history}`} id="islem-gecmisim" aria-labelledby="scan-history-title">
        <h2 id="scan-history-title">İşlem geçmişim</h2>
        {historyError && <p className={styles.error} role="status">{historyError}</p>}
        {activity ? <>
          <p className={styles.count}><strong>{activity.pending.length}</strong> yönetici onayı bekliyor</p>
          {activity.history.length ? <ul>
            {activity.history.map(item => <li key={item.requestId}>
              <div><strong>{item.name}</strong><small>Lot {item.lot}</small></div>
              <span data-status={item.status} className={styles.badge}>{requestStatus[item.status]}</span>
              <p>{item.choice} · {item.reason}</p>{item.reviewReason && <p>Yönetici gerekçesi: {item.reviewReason}</p>}
              <time dateTime={item.time}>{dateTime.format(new Date(item.time))}</time>
            </li>)}
          </ul> : <p>Henüz gönderilmiş kontrol yok.</p>}
        </> : <p>{historyError ? 'Yeniden deneniyor…' : 'Kayıtlar yükleniyor…'}</p>}
      </section>
    </main>
  </div>;
}
