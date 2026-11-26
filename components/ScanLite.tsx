import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslate } from './LanguagePicker';
import TraceCamera from './TraceCamera';
import type { PanelRole } from '../server/panels';

type CatalogProduct = { barcode: string; name: string };
type RecordMatch = CatalogProduct & { id: string; lot: string; type: string; status: string };
type Lookup = { catalog: CatalogProduct | null; records: RecordMatch[] };
type Operation = { id: string; title: string };

export default function ScanLite({ role, mobile }: { role: PanelRole; mobile: boolean }) {
  const t = useTranslate();
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [result, setResult] = useState<Lookup | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [operation, setOperation] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(false);
  const revision = useRef(0);
  const product = result?.catalog ?? result?.records[0];

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
      setStatus('');
      setBusy(false);
    }
    store?.addEventListener('change', resetStore);
    return () => store?.removeEventListener('change', resetStore);
  }, []);

  async function submit(rawCode: string, catalogName?: string) {
    const code = rawCode.trim();
    if (!code || busy) return;
    const currentRevision = ++revision.current;
    setBusy(true);
    setFailed(false);
    setStatus(t('Kayıtlar yükleniyor…'));
    setResult(null);
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
      if (catalogName !== undefined) await request(path, { barcode: code, name: catalogName });
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
      setStatus(catalogName !== undefined ? 'Ürün pilot kataloğa kaydedildi.'
        : lookup.catalog || lookup.records.length ? '' : 'Bu barkod için ürün kaydı bulunamadı.');
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
        <label htmlFor="scan-lite-code">{t('Barkod')}
          <input id="scan-lite-code" value={barcode} maxLength={80} required disabled={busy} autoComplete="off"
            onChange={event => { setBarcode(event.target.value); setResult(null); setName(''); setStatus(''); }} />
        </label>
        <button disabled={busy}>{t('Ürünü sorgula')}</button>
        <TraceCamera disabled={busy || !active} onRead={code => void submit(code)} />
      </div>
    </form>
    <p className={failed ? 'status error' : 'status'} role="status">{t(status)}</p>
    {result?.catalog && <p><strong>{result.catalog.name}</strong> · {t('Pilot ürün kataloğu')}</p>}
    {!!result?.records.length && <div className="scroll"><table aria-label={t('Operasyon kayıtları')}>
      <thead><tr><th>{t('Ürün')}</th><th>{t('Barkod / Lot')}</th><th>{t('Operasyon')}</th><th>{t('Durum')}</th><th>{t('İşlem')}</th></tr></thead>
      <tbody>{result.records.map(record => <tr key={record.id}>
        <td>{record.name}</td><td>{record.barcode} · {record.lot}</td><td>{t(record.type)}</td><td>{t(record.status)}</td>
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
    {role === 'admin' && <form onSubmit={event => { event.preventDefault(); void submit(barcode, name); }}>
      <h3>{t('Pilot ürün kataloğu')}</h3>
      <label htmlFor="scan-lite-name">{t('Ürün adı')}</label>
      <input id="scan-lite-name" value={name} maxLength={150} required disabled={busy} onChange={event => setName(event.target.value)} />
      <p><button type="submit" disabled={busy || !barcode.trim()}>{t('Kataloğa kaydet')}</button></p>
    </form>}
  </section>;
}
