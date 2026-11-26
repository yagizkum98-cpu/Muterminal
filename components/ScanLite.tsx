import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLanguage, useTranslate } from './LanguagePicker';
import TraceCamera from './TraceCamera';
import type { PanelRole } from '../server/panels';

type Product = { barcode: string; name: string };
type CatalogProduct = Product & {
  productCode?: string; price?: number | null; caseQuantity?: number | null;
  priceValidFrom?: string; priceValidTo?: string; orderStatus?: string; saleStatus?: string;
};
type RecordMatch = Product & { id: string; lot: string; type: string; status: string; expiryDate: string | null };
type Snapshot = { warehouseCode: string; quantity: number; sourceUpdatedAt: string };
type Lookup = { catalog: CatalogProduct | null; records: RecordMatch[]; snapshots: Snapshot[]; storeId: string; barcodes: string[] };
type Operation = { id: string; title: string };
const editFields = [
  ['productCode', 'Ürün kodu', 'text'], ['price', 'Fiyat (TL)', 'text'], ['caseQuantity', 'Koli içi miktar', 'number'],
  ['priceValidFrom', 'Fiyat başlangıç tarihi', 'date'], ['priceValidTo', 'Fiyat bitiş tarihi', 'date'],
  ['orderStatus', 'Sipariş durumu', 'text'],
] as const;
const saleLabels = { sellable: 'Satılabilir', blocked: 'Satışa kapalı', unknown: 'Doğrulanmadı' };
const csvHeader = 'barcode,product_code,product_name,price_try,case_quantity,price_valid_from,price_valid_to,order_status,sale_status,warehouse_code,stock_quantity,source_updated_at';

function productDraft(card?: CatalogProduct | null) {
  return {
    productCode: card?.productCode ?? '', price: card?.price == null ? '' : (card.price / 100).toFixed(2),
    caseQuantity: card?.caseQuantity == null ? '' : String(card.caseQuantity), priceValidFrom: card?.priceValidFrom ?? '',
    priceValidTo: card?.priceValidTo ?? '', orderStatus: card?.orderStatus ?? '', saleStatus: card?.saleStatus ?? '',
  };
}

export default function ScanLite({ role, mobile }: { role: PanelRole; mobile: boolean }) {
  const t = useTranslate();
  const locale = useLanguage() === 'en' ? 'en-GB' : 'tr-TR';
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState(productDraft);
  const [csvFile, setCsvFile] = useState<File>();
  const [result, setResult] = useState<Lookup | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [operation, setOperation] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(false);
  const revision = useRef(0);
  const product = result?.catalog ?? result?.records[0];
  const card = result?.catalog;

  useEffect(() => {
    function select(event: Event) {
      setActive((event as CustomEvent<string>).detail === 'scan-lite');
    }
    document.addEventListener('muterminal:module', select);
    setActive(document.getElementById('modules')?.querySelector('[data-module="scan-lite"]')?.getAttribute('aria-pressed') === 'true');
    return () => document.removeEventListener('muterminal:module', select);
  }, []);

  useEffect(() => {
    const store = document.getElementById('store-filter');
    function resetStore() {
      revision.current++;
      setResult(null);
      setName('');
      setDraft(productDraft());
      setStatus('');
      setBusy(false);
    }
    store?.addEventListener('change', resetStore);
    return () => store?.removeEventListener('change', resetStore);
  }, []);

  async function submit(rawCode: string, change?: { catalog: string } | { csv: File }) {
    const code = rawCode.trim();
    if ((!code && !(change && 'csv' in change)) || busy) return;
    const currentRevision = ++revision.current;
    const catalogBarcode = result?.catalog?.barcode ?? code;
    setBusy(true);
    setFailed(false);
    setStatus(t('Kayıtlar yükleniyor…'));
    if (!change) setResult(null);
    setBarcode(code);
    const headers: Record<string, string> = { 'X-MuTerminal-Panel': role };
    if (mobile) headers['X-MuTerminal-Mobile'] = '1';
    const store = role === 'admin' && document.querySelector<HTMLSelectElement>('#store-filter')?.value;
    const query = new URLSearchParams({ code });
    if (store) query.set('store', store);
    const path = `/api/scan-lite?${query}`;
    async function request(url: string, body?: object) {
      const response = await fetch(url, body ? {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      } : { headers });
      if (response.status === 401) {
        window.location.assign(`/?panel=${role}${mobile ? '&mobil=1' : ''}#admin-giris`);
        throw new Error('Oturum süresi doldu.');
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'İşlem tamamlanamadı.');
      return data;
    }

    try {
      let message = '';
      if (change && 'catalog' in change) {
        await request(path, { barcode: catalogBarcode, name: change.catalog, ...draft });
        message = t('Ürün pilot kataloğa kaydedildi.');
      }
      if (change && 'csv' in change) {
        if (change.csv.size > 400_000) throw new Error('CSV dosyası 400 KB veya daha küçük olmalıdır.');
        const count = await request(`/api/scan-lite/import?${query}`, { csv: await change.csv.text() });
        message = t('{products} ürün, {snapshots} stok kaydı aktarıldı. Atlanan stok kaydı: {skipped}.', count);
      }
      if (!code) {
        if (currentRevision === revision.current) setStatus(message);
        return;
      }
      const [lookup, definitions]: [Lookup, Record<string, { title: string; disabled?: boolean }>] = await Promise.all([
        request(path), request('/api/operations'),
      ]);
      if (currentRevision !== revision.current) return;
      const available = Object.entries(definitions).filter(([, item]) => !item.disabled)
        .map(([id, item]) => ({ id, title: item.title }));
      setOperations(available);
      setOperation(current => available.some(item => item.id === current) ? current : available[0]?.id ?? '');
      setResult(lookup);
      setName(lookup.catalog?.name ?? '');
      setDraft(productDraft(lookup.catalog));
      setStatus(message || (lookup.catalog || lookup.records.length ? '' : 'Bu barkod için ürün kaydı bulunamadı.'));
    } catch (error) {
      if (currentRevision !== revision.current) return;
      setFailed(true);
      setStatus(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
    } finally {
      if (currentRevision === revision.current) setBusy(false);
    }
  }

  function lookup(event: FormEvent) {
    event.preventDefault();
    void submit(barcode);
  }

  return <section id="scan-lite-panel" aria-labelledby="scan-lite-title" hidden={!active}>
    <h2 id="scan-lite-title">MuScan Lite</h2>
    <form onSubmit={lookup}>
      <div className="toolbar">
        <label htmlFor="scan-lite-code">{t('Barkod veya ürün kodu')}
          <input id="scan-lite-code" value={barcode} maxLength={80} required disabled={busy} autoComplete="off"
            onChange={event => { setBarcode(event.target.value); setResult(null); setName(''); setDraft(productDraft()); setStatus(''); }} />
        </label>
        <button disabled={busy}>{t('Ürünü sorgula')}</button>
        <TraceCamera disabled={busy || !active} onRead={code => void submit(code)} />
      </div>
    </form>
    <p className={failed ? 'status error' : 'status'} role="status">{t(status)}</p>
    {product && <div className="scan-product-card">
      <h3>MuProduct · {product.name}</h3>
      <dl>
        <div><dt>{t('Barkod')}</dt><dd>{product.barcode}</dd></div>
        <div><dt>{t('Ürün kodu')}</dt><dd>{card?.productCode || '—'}</dd></div>
        <div><dt>{t('Fiyat (TL)')}</dt><dd>{card?.price == null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'TRY' }).format(card.price / 100)}</dd></div>
        <div><dt>{t('Koli içi miktar')}</dt><dd>{card?.caseQuantity ?? '—'}</dd></div>
        {(card?.priceValidFrom || card?.priceValidTo) && <div><dt>{t('Fiyat geçerlilik aralığı')}</dt><dd>{card.priceValidFrom || '—'} → {card.priceValidTo || '—'}</dd></div>}
        <div><dt>{t('Sipariş durumu')}</dt><dd>{card?.orderStatus || '—'}</dd></div>
        <div><dt>{t('Kaynak satış durumu')}</dt><dd>{t(saleLabels[(card?.saleStatus || 'unknown') as keyof typeof saleLabels] ?? 'Doğrulanmadı')}</dd></div>
      </dl>
      <p>{t('Ürün kartındaki bilgiler pilot kaynağından gelir. Satış işlemleri yetkili kaynakta doğrulanır.')}</p>
      <button type="button" className="secondary" onClick={() => document.dispatchEvent(new CustomEvent('muterminal:scan-history', {
        detail: { barcode: product.barcode, name: product.name, storeId: result?.storeId, barcodes: result?.barcodes },
      }))}>MuTrace Lite · {t('Ürün karar geçmişi')}</button>
      <h4>MuStock Lite · {t('Depo stok kayıtları')}</h4>
      {result?.snapshots.length ? <div className="scroll"><table aria-label={t('Depo stok kayıtları')}>
        <thead><tr><th>{t('Depo kodu')}</th><th>{t('Stok miktarı')}</th><th>{t('Kaynak güncelleme zamanı')}</th></tr></thead>
        <tbody>{result.snapshots.map(snapshot => <tr key={snapshot.warehouseCode}>
          <td>{snapshot.warehouseCode}</td><td>{new Intl.NumberFormat(locale).format(snapshot.quantity)}</td>
          <td><time dateTime={snapshot.sourceUpdatedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(new Date(snapshot.sourceUpdatedAt))}</time></td>
        </tr>)}</tbody>
      </table></div> : <p>{t('Bu ürün için depo stok kaydı yok.')}</p>}
    </div>}
    {!!result?.records.length && <div className="scroll"><table aria-label={t('Operasyon kayıtları')}>
      <thead><tr><th>{t('Ürün')}</th><th>{t('Barkod / Lot')}</th><th>{t('Operasyon')}</th><th>{t('Durum')}</th><th>{t('SKT')}</th><th>{t('İşlem')}</th></tr></thead>
      <tbody>{result.records.map(record => <tr key={record.id}>
        <td>{record.name}</td><td>{record.barcode} · {record.lot}</td><td>{t(record.type)}</td><td>{t(record.status)}</td><td>{record.expiryDate ?? '—'}</td>
        <td><button type="button" className="secondary" onClick={() => document.dispatchEvent(new CustomEvent('muterminal:scan-open', { detail: record.id }))}>{t('Operasyon kaydına git')}</button></td>
      </tr>)}</tbody>
    </table></div>}
    {product && operations.length > 0 && <div className="toolbar">
      <label htmlFor="scan-lite-operation">{t('Operasyon')}
        <select id="scan-lite-operation" value={operation} onChange={event => setOperation(event.target.value)}>
          {operations.map(item => <option key={item.id} value={item.id}>{t(item.title)}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => document.dispatchEvent(new CustomEvent('muterminal:scan-entry', {
        detail: { name: product.name, barcode: product.barcode, lot: 'lot' in product ? product.lot : '', operation },
      }))}>{t('Kontrol kaydı oluştur')}</button>
    </div>}
    {role === 'admin' && <form onSubmit={event => { event.preventDefault(); void submit(barcode, { catalog: name }); }}>
      <h3>{t('Pilot ürün kataloğu')}</h3>
      <label htmlFor="scan-lite-name">{t('Ürün adı')}</label>
      <input id="scan-lite-name" value={name} maxLength={150} required disabled={busy} onChange={event => setName(event.target.value)} />
      <div className="fields">
        {editFields.map(([key, label, kind]) => <div key={key}>
          <label htmlFor={`scan-lite-${key}`}>{t(label)}</label>
          <input id={`scan-lite-${key}`} type={kind} min={kind === 'number' ? 1 : undefined} value={draft[key]} disabled={busy}
            onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
        </div>)}
        <div><label htmlFor="scan-lite-sale-status">{t('Kaynak satış durumu')}</label>
          <select id="scan-lite-sale-status" value={draft.saleStatus || 'unknown'} disabled={busy}
            onChange={event => setDraft({ ...draft, saleStatus: event.target.value })}>
            <option value="unknown">{t('Doğrulanmadı')}</option>
            <option value="sellable">{t('Satılabilir')}</option>
            <option value="blocked">{t('Satışa kapalı')}</option>
          </select>
        </div>
      </div>
      <p><button type="submit" disabled={busy || !barcode.trim()}>{t('Kataloğa kaydet')}</button></p>
    </form>}
    {role === 'admin' && <form onSubmit={event => { event.preventDefault(); if (csvFile) void submit(barcode, { csv: csvFile }); }}>
      <h3>MuSync Lite</h3>
      <p><a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvHeader + '\n')}`} download="muterminal-pilot.csv">{t('CSV şablonunu indir')}</a></p>
      <label htmlFor="scan-lite-csv">{t('Yetkili katalog ve stok CSV dosyası')}</label>
      <input id="scan-lite-csv" type="file" accept=".csv,text/csv" required disabled={busy}
        onChange={event => setCsvFile(event.target.files?.[0])} />
      <p><button disabled={busy || !csvFile}>{t('CSV aktar')}</button></p>
    </form>}
  </section>;
}
