import LanguagePicker, { useLanguage, useTranslate } from '../components/LanguagePicker';
import ChangePassword from '../components/ChangePassword';
import { languageFromCookie } from '../lib/language';
import { useEffect, useState, type FormEvent } from 'react';
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import TraceCamera from '../components/TraceCamera';
import { traceStages, type TraceControl, type TraceEvent, type TraceLot, type TraceOperation, type TraceReport, type TraceStage, type PersonalReport } from '../components/trace-model';
import { traceChoices, traceRoles, warehouseChoice, type TraceAccess } from '../components/trace-policy';
import TraceManagement from '../components/TraceManagement';
import MobileNav, { type MobileSection } from '../components/MobileNav';
import styles from '../components/Trace.module.css';
import { getSession } from '../server/application';
import { resolveTraceAccess } from '../server/trace-access';
import { createChallenge } from '../server/challenge';
import { mobileStaffState } from '../server/mobile-access';
import { scanEnabled } from '../server/features';
import type { PanelRole } from '../server/panels';

interface Props {
  role: PanelRole | 'trace' | null;
  access: TraceAccess | null;
  email: string | null;
  displayName: string | null;
  challengeId: string | null;
  loginError: string | null;
  canScan: boolean;
  initialCode: string;
  initialLot: string;
  initialStore: string;
  mobile: boolean;
  initialTab: Exclude<MobileSection, 'home'>;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ req, res, query }) => {
  res.setHeader('Cache-Control', 'no-store');
  const session = await getSession(req);
  const mobile = query.mobil === '1' || session?.mobile === true;
  if (session && mobile && await mobileStaffState(session) !== 'allowed') {
    return { redirect: { destination: '/mobil', permanent: false } };
  }
  let challengeId: string | null = null;
  if (!session) {
    try { challengeId = await createChallenge(); }
    catch (error) { console.error('MU TRACE login challenge:', error); }
  }
  const access = session ? await resolveTraceAccess(session) : null;
  const initialTab = access?.role === 'super' || (mobile && access?.canManage && query.bolum === 'yonetim') ? 'management'
    : mobile && access && query.bolum === 'rapor' ? 'report' : 'lookup';
  return { props: {
    role: session?.role ?? null,
    access,
    email: session?.email ?? null,
    displayName: session?.displayName ?? null,
    challengeId,
    loginError: query.giris === 'bilgi' ? 'Kullanıcı adı veya şifre hatalı.'
      : query.giris === 'dogrulama' ? 'Doğrulama kodu hatalı veya süresi dolmuş.' : null,
    canScan: session?.role === 'staff' && scanEnabled(),
    initialCode: typeof query.code === 'string' ? query.code.slice(0, 512) : '',
    initialLot: typeof query.lot === 'string' ? query.lot.slice(0, 80) : '',
    initialStore: typeof query.store === 'string' ? query.store.slice(0, 50) : '',
    mobile, initialTab, language: languageFromCookie(req.headers.cookie),
  } };
};

function useTimeText() {
  const locale = useLanguage() === 'en' ? 'en-GB' : 'tr-TR';
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
  return (value?: string) => value && Number.isFinite(Date.parse(value)) ? formatter.format(new Date(value)) : '';
}
const lotKey = (lot: TraceLot) => JSON.stringify([lot.storeId, lot.barcode, lot.lot]);
const eventTitles = { movement: 'Ürün hareketi', recall_opened: 'Geri çağırma açıldı', recall_closed: 'Geri çağırma kapatıldı' };
const detailLabels: Record<string, string> = {
  blockReason: 'Blokaj nedeni', blockEndsAt: 'Blokaj bitişi', expiryDate: 'SKT', returnReason: 'İade gerekçesi',
  systemStock: 'Sistem stoku', physicalStock: 'Fiziksel sayım', dockNote: 'Sevkiyat kontrol notu', destination: 'Varış noktası',
};

async function api<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'İşlem tamamlanamadı.');
  return data as T;
}

function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

type Submit = (path: string, body: object, success: string) => Promise<boolean>;

function MovementForm({ productId, stages, busy, submit }: { productId: string; stages: TraceStage[]; busy: boolean; submit: Submit }) {
  const t = useTranslate();
  const [attempt, setAttempt] = useState<{ id: string; data: string }>();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const data = {
      productId,
      stage: values.get('stage'),
      origin: String(values.get('origin')).trim(),
      location: values.get('location'),
      quantity: values.get('quantity') ? Number(values.get('quantity')) : null,
      note: values.get('note'),
    };
    const encoded = JSON.stringify(data);
    const id = attempt?.data === encoded ? attempt.id : requestId();
    setAttempt({ id, data: encoded });
    if (await submit('/api/trace/movements', { ...data, id }, 'Hareket kaydedildi.')) {
      form.reset();
      setAttempt(undefined);
    }
  }
  return <details className={styles.disclosure}>
    <summary>{t("Hareket kaydet")}</summary>
    <form onSubmit={save} className={styles.form}>
      <div className={styles.fields}>
        <label>{t("Aşama")}<select name="stage" defaultValue="" required>
          <option value="" disabled>{t("Aşama seçin")}</option>
          {stages.map(stage => <option key={stage} value={stage}>{t(traceStages[stage])}</option>)}
        </select></label>
        <label>{t("Çıkış konumu")}<input name="origin" maxLength={150} /></label>
        <label>{t("Ürünün ulaştığı konum")}<input name="location" maxLength={150} required /></label>
        <label>{t("Miktar")}<input type="number" name="quantity" min={1} max={2147483647} /></label>
      </div>
      <label>{t("Açıklama")}<textarea name="note" maxLength={1000} required /></label>
      <button disabled={busy}>{t("Hareketi kaydet")}</button>
    </form>
  </details>;
}

function RecallForm({ productId, recall, busy, submit }: { productId?: string; recall?: TraceEvent; busy: boolean; submit: Submit }) {
  const t = useTranslate();
  return <details className={styles.disclosure}>
    <summary>{recall ? t("Geri çağırmayı kapat") : t("Geri çağırma aç")}</summary>
    <form className={styles.form} onSubmit={async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const note = new FormData(form).get('note');
      const path = recall ? '/api/trace/recalls/close' : '/api/trace/recalls';
      const body = recall ? { recallId: recall.id, note } : { productId, note };
      if (await submit(path, body, recall ? 'Geri çağırma kapatıldı.' : 'Geri çağırma açıldı.')) form.reset();
    }}>
      <label>{recall ? t("Kapatma gerekçesi") : t("Geri çağırma gerekçesi")}<textarea name="note" maxLength={1000} required /></label>
      <button className={recall ? styles.secondary : styles.danger} disabled={busy}>{recall ? t("Kapatmayı kaydet") : t("Geri çağırmayı kaydet")}</button>
    </form>
  </details>;
}

function Operation({ operation }: { operation: TraceOperation }) {
  const t = useTranslate();
  const timeText = useTimeText();
  return <article className={styles.operation}>
    <div className={styles.row}><h3>{t(operation.type)}</h3><span className={styles.tag}>{t(operation.status)}</span></div>
    <p className={styles.muted}>{[timeText(operation.time), operation.qty != null ? t('{qty} adet', { qty: operation.qty }) : ''].filter(Boolean).join(' · ')}</p>
    {operation.risk && <p className={styles.warning}>{t(operation.risk.label)}</p>}
    {operation.details && <dl className={styles.details}>
      {Object.entries(operation.details).filter(([name]) => Object.hasOwn(detailLabels, name)).map(([name, value]) =>
        <div key={name}><dt>{t(detailLabels[name])}</dt><dd>{value}</dd></div>)}
    </dl>}
  </article>;
}

const outcomes = { approve: 'Onaylandı', reject: 'Reddedildi', recheck: 'Ek kontrol istendi' };
const rksNames = { clear: 'Blokaj görülmedi', blocked: 'Blokaj görüldü', unknown: 'Doğrulanamadı' };
const conditionNames = { good: 'Uygun', damaged: 'Hasarlı', unknown: 'Doğrulanamadı' };

function ControlForm({ productId, access, busy, submit, followupOf }: {
  productId: string; access: TraceAccess; busy: boolean; submit: Submit; followupOf?: string;
}) {
  const t = useTranslate();
  return <details className={styles.disclosure}>
    <summary>{followupOf ? t("Ek kontrol kaydet") : t("Manuel kontrol ve karar talebi")}</summary>
    <form className={styles.form} onSubmit={async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const payload = Object.fromEntries(fields);
      if (await submit('/api/trace/decisions', { ...payload, productId, expiryDate: payload.expiryDate || null, followupOf },
        'Kontrol kaydedildi ve talep onaya gönderildi.')) form.reset();
    }}>
      <div className={styles.fields}>
        <label>{t("Kontrol konumu")}<input name="location" maxLength={150} required /></label>
        <label>{t("Ürün üzerindeki SKT")}<input type="date" name="expiryDate" /></label>
        <label>{t("RKS kontrolü")}<select name="rks" defaultValue="" required>
          <option value="" disabled>{t("RKS sonucunu seçin")}</option>
          {Object.entries(rksNames).map(([value, name]) => <option key={value} value={value}>{t(name)}</option>)}
        </select></label>
        <label>{t("Fiziksel kontrol")}<select name="condition" defaultValue="" required>
          <option value="" disabled>{t("Fiziksel sonucu seçin")}</option>
          {Object.entries(conditionNames).map(([value, name]) => <option key={value} value={value}>{t(name)}</option>)}
        </select></label>
      </div>
      <label>{t("Önerilen karar")}<select name="choice" defaultValue="" required>
        <option value="" disabled>{t("Karar seçin")}</option>
        {traceChoices.filter(choice => access.warehouseId || choice !== warehouseChoice).map(choice => <option key={choice} value={choice}>{t(choice)}</option>)}
      </select></label>
      <label>{t("Kontrol sonucu ve gerekçe")}<textarea name="reason" maxLength={1000} required /></label>
      <button disabled={busy}>{t("Onaya gönder")}</button>
    </form>
  </details>;
}

function ControlDetails({ control, productId, access, email, busy, submit }: {
  control: TraceControl; productId?: string; access: TraceAccess; email: string | null; busy: boolean; submit: Submit;
}) {
  const t = useTranslate();
  const timeText = useTimeText();
  return <article className={styles.operation}>
    <div className={styles.row}><h3>{t(control.choice)}</h3><span className={styles.tag}>{control.outcome ? t(outcomes[control.outcome]) : t("Onay bekliyor")}</span></div>
    <p className={styles.muted}>{timeText(control.time)} · {control.actor} · {control.location}</p>
    <p>{t("RKS") + " "}{t(rksNames[control.checks.rks as keyof typeof rksNames])}{" " + t("· SKT") + " "}{control.checks.expiryDate || t("Doğrulanamadı")}
      {control.checks.expired && ` ${t('(geçmiş)')}`}{" " + t("· Fiziksel durum") + " "}{t(conditionNames[control.checks.condition as keyof typeof conditionNames])}</p>
    <p>{control.note}</p>
    {control.checks.legacyChoice && <p className={styles.muted}>{t("Önceki MU TRACE önerisi ·") + " "}{t(control.checks.legacyChoice)}</p>}
    {control.followupOf && <p className={styles.muted}>{t("Ek kontrol kaydı")}</p>}
    {control.reviewNote && <p><strong>{control.outcome && t(outcomes[control.outcome])}</strong> · {timeText(control.reviewedAt ?? undefined)}
      {' · '}{control.reviewer} · {control.reviewNote}</p>}
    {control.canReview && <form className={styles.form} onSubmit={async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form, (event.nativeEvent as SubmitEvent).submitter);
      const outcome = fields.get('outcome') as keyof typeof outcomes | null;
      if (!outcome) return;
      if (await submit('/api/trace/review', { id: control.id, reason: fields.get('reason'), outcome }, t('Talep · {outcome}', { outcome: t(outcomes[outcome]) }))) form.reset();
    }}>
      <label>{t("İnceleme gerekçesi")}<textarea name="reason" maxLength={1000} required /></label>
      <div className={styles.actions}>
        <button name="outcome" value="approve" disabled={busy}>{t("Onayla")}</button>
        <button name="outcome" value="reject" className={styles.secondary} disabled={busy}>{t("Reddet")}</button>
        <button name="outcome" value="recheck" className={styles.secondary} disabled={busy}>{t("Ek kontrol iste")}</button>
      </div>
    </form>}
    {productId && access.canControl && control.outcome === 'recheck' && control.actor === email && !control.hasFollowup &&
      <ControlForm productId={productId} access={access} busy={busy} submit={submit} followupOf={control.id} />}
  </article>;
}

function Timeline({ lot }: { lot: TraceLot }) {
  const t = useTranslate();
  const timeText = useTimeText();
  const events = lot.events.map(event => ({
    key: event.id, time: event.time, source: 'MU TRACE',
    title: t(event.stage ? traceStages[event.stage] : eventTitles[event.kind]),
    context: [event.origin, event.location].filter(Boolean).join(' → '),
    info: [event.quantity != null ? t('{qty} adet', { qty: event.quantity }) : '', event.actor].filter(Boolean).join(' · '),
    note: event.note,
  }));
  for (const operation of lot.operations) {
    events.push({
      key: operation.id, time: operation.time ?? '', source: 'MuTerminal CORE',
      title: t('{operation} kaydı', { operation: t(operation.type) }), context: '', info: '', note: '',
    });
    operation.decisions.forEach((decision, index) => events.push({
      key: `${operation.id}-${index}`, time: decision.time,
      source: decision.source === 'scan' ? 'MuTerminal Scan' : decision.source === 'trace' ? 'MU TRACE · MuDecision' : 'MuDecision',
      title: t(decision.choice), context: t(decision.result ?? ''), info: decision.actor ?? '', note: decision.reason ?? '',
    }));
  }
  for (const control of lot.controls) {
    events.push({
      key: `control-${control.id}`, time: control.time, source: 'MU TRACE',
      title: t('Manuel kontrol ve karar talebi'), context: t(control.choice), info: `${control.location} · ${control.actor}`, note: '',
    });
    if (control.outcome && control.reviewedAt) events.push({
      key: `review-${control.id}`, time: control.reviewedAt, source: 'MU TRACE',
      title: t(outcomes[control.outcome]), context: t(control.choice), info: control.reviewer ?? '', note: control.reviewNote ?? '',
    });
  }
  events.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
  return <ol className={styles.timeline}>
    {events.map(event => <li key={event.key}>
      <div className={styles.eventMeta}><span>{event.source}</span><time dateTime={event.time || undefined}>{timeText(event.time)}</time></div>
      <strong>{event.title}</strong>
      {(event.context || event.info) && <p>{[event.context, event.info].filter(Boolean).join(' · ')}</p>}
      {event.note && <p>{event.note}</p>}
    </li>)}
  </ol>;
}

function Reporting({ report, openLot }: { report: TraceReport | PersonalReport; openLot: (barcode: string, lot: string, store: string) => void }) {
  const t = useTranslate();
  const timeText = useTimeText();
  if ('personal' in report) return <section className={styles.card} aria-labelledby="personal-report">
    <h2 id="personal-report">{t("Kontrol özetim")}</h2>
    <dl className={styles.details}>
      <div><dt>{t("Kontrol")}</dt><dd>{report.personal.controls}</dd></div>
      <div><dt>{t("İncelenen")}</dt><dd>{report.personal.reviewed}</dd></div>
      <div><dt>{t("Onay bekleyen")}</dt><dd>{report.personal.pending}</dd></div>
    </dl>
  </section>;
  const storeName = (id: string) => Object.hasOwn(report.locations, id) ? t(report.locations[id]) : id;
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = t('mu-trace-rapor.json');
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className={styles.report}>
    <section className={styles.card} aria-labelledby="report-title">
      <div className={styles.row}><h2 id="report-title">{t("Mağaza bazında operasyon özeti")}</h2><button className={styles.secondary} onClick={download}>{t("JSON indir")}</button></div>
      {report.stores.length ? <div className={styles.tableScroll}><table>
        <thead><tr><th>{t("Mağaza")}</th><th>{t("Lot")}</th><th>{t("Operasyon")}</th><th>{t("Karar / talep")}</th><th>{t("Onay bekleyen")}</th><th>{t("Hareket")}</th><th>{t("Açık geri çağırma")}</th></tr></thead>
        <tbody>{report.stores.map(store => <tr key={store.storeId}>
          <th scope="row">{storeName(store.storeId)}</th><td>{store.lots}</td><td>{store.operations}</td><td>{store.decisions}</td>
          <td>{store.pending}</td><td>{store.movements}</td><td>{store.openRecalls}</td>
        </tr>)}</tbody>
      </table></div> : <p>{t("Raporlanacak kayıt bulunamadı.")}</p>}
    </section>
    <section className={styles.card} aria-labelledby="pending-reviews">
      <h2 id="pending-reviews">{t("Onay bekleyen talepler")}</h2>
      {report.pending.length ? <ul className={styles.resultList}>{report.pending.map(item => <li key={item.id}>
        <button className={styles.linkButton} onClick={() => openLot(item.barcode, item.lot, item.storeId)}>{item.name} · {item.lot}</button>
        <p>{storeName(item.storeId)} · {t(item.choice)} · {timeText(item.time)}</p>
      </li>)}</ul> : <p>{t("Onay bekleyen talep bulunmuyor.")}</p>}
      {report.pending.length === 100 && <p className={styles.muted}>{t("Son 100 talep gösteriliyor.")}</p>}
    </section>
    <section className={styles.card} aria-labelledby="open-recalls">
      <h2 id="open-recalls">{t("Açık geri çağırmalar")}</h2>
      {report.recalls.length ? <ul className={styles.resultList}>{report.recalls.map(recall => <li key={recall.id}>
        <button className={styles.linkButton} onClick={() => openLot(recall.barcode, recall.lot, recall.storeId)}>{recall.name} · {recall.lot}</button>
        <p>{storeName(recall.storeId)} · {timeText(recall.time)} · {recall.note}</p>
      </li>)}</ul> : <p>{t("Açık geri çağırma bulunmuyor.")}</p>}
    </section>
    <section className={styles.card} aria-labelledby="risk-lots">
      <h2 id="risk-lots">{t("Kontrol gerektiren lotlar")}</h2>
      {report.risks.length ? <ul className={styles.resultList}>{report.risks.map(lot => <li key={JSON.stringify(lot)}>
        <button className={styles.linkButton} onClick={() => openLot(lot.barcode, lot.lot, lot.storeId)}>{lot.name} · {lot.lot}</button>
        <p>{storeName(lot.storeId)} · {t(lot.risk)}</p>
      </li>)}</ul> : <p>{t("SKT uyarısı veya blokaj bulunan lot yok.")}</p>}
      {report.risks.length === 100 && <p className={styles.muted}>{t("İlk 100 risk kaydı gösteriliyor.")}</p>}
    </section>
  </div>;
}

export default function Trace({ role, access, email, displayName, challengeId, loginError, canScan, initialCode, initialLot, initialStore, mobile, initialTab }: Props) {
  const t = useTranslate();
  const [code, setCode] = useState(initialCode);
  const [filterLot, setFilterLot] = useState(initialLot);
  const [search, setSearch] = useState({ code: initialCode, lot: initialLot });
  const [lots, setLots] = useState<TraceLot[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState(initialTab);
  const [report, setReport] = useState<TraceReport | PersonalReport | null>(null);
  const current = lots?.find(lot => lotKey(lot) === selected);
  const activeRecall = current?.events.find(event => event.activeRecall);
  const productId = current?.operations[0]?.id;
  const canLookup = Boolean(access && access.role !== 'super');
  const mobileParam = mobile ? '&mobil=1' : '';

  async function loadLookup(value: string, filter: string, preferredStore?: string) {
    const params = new URLSearchParams({ code: value });
    if (filter) params.set('lot', filter);
    const data = await api<{ lots: TraceLot[] }>(`/api/trace/lookup?${params}`);
    setLots(data.lots);
    setSelected(prior => {
      const preferred = preferredStore && data.lots.find(lot => lot.storeId === preferredStore);
      if (preferred) return lotKey(preferred);
      if (data.lots.some(lot => lotKey(lot) === prior)) return prior;
      return data.lots[0] ? lotKey(data.lots[0]) : '';
    });
  }

  useEffect(() => {
    if (!canLookup || initialTab !== 'lookup' || !initialCode) return;
    setBusy(true);
    void loadLookup(initialCode, initialLot, initialStore).catch(failure => setError((failure as Error).message)).finally(() => setBusy(false));
  }, [canLookup, initialTab, initialCode, initialLot, initialStore]);

  useEffect(() => {
    if (initialTab !== 'report') return;
    setBusy(true);
    void api<TraceReport | PersonalReport>('/api/trace/report').then(setReport)
      .catch(failure => setError((failure as Error).message)).finally(() => setBusy(false));
  }, [initialTab]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'İşlem tamamlanamadı.'); }
    finally { setBusy(false); }
  }

  function lookup(value: string, filter: string, preferredStore?: string) {
    void run(async () => {
      setCode(value);
      setFilterLot(filter);
      setSearch({ code: value, lot: filter });
      setTab('lookup');
      setLots(null);
      await loadLookup(value, filter, preferredStore);
    });
  }

  const submit: Submit = async (path, body, success) => {
    let saved = false;
    await run(async () => {
      await api(path, body);
      saved = true;
      setNotice(success);
      try {
        await loadLookup(search.code, search.lot);
        if (report) setReport(await api<TraceReport | PersonalReport>('/api/trace/report'));
      } catch {
        setError('Kayıt tamamlandı. Güncel verileri görmek için yeniden sorgulayın.');
      }
    });
    return saved;
  };

  return <div className={styles.shell} data-mobile={mobile}>
    <Head>
      <title>MU TRACE | MuTerminal</title>
      <meta name="description" content={t("MuTerminal ürün ve lot izlenebilirliği")} />
      {mobile && <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" key="viewport" />}
    </Head>
    <header className={styles.header}>
      <div className={styles.wrap}>
        <a className={styles.brand} href={mobile ? '/mobil' : '/trace'}>
          <img src="/mu-trace-logo.png" width="2172" height="724" alt={t("MU TRACE — Ürün İzlenebilirlik Platformu")} />
        </a>
        <div className={styles.actions}>
          <LanguagePicker />
          {mobile ? !access && <a className={styles.back} href="/mobil">{t("Ana ekran")}</a>
            : role !== 'trace' && <a className={styles.back} href={role ? `/${role}` : '/'}>{role ? t("MuTerminal paneli") : 'MuTerminal'}</a>}
          {access && <form method="post" action={mobile ? '/admin/logout?mobil=1' : '/admin/logout'}><button className={styles.secondary}>{t("Oturumu kapat")}</button></form>}
        </div>
      </div>
    </header>
    <main className={styles.wrap}>
      {access && role === 'trace' && <ChangePassword mobile={mobile} signIn={mobile ? '/trace?mobil=1' : '/trace'} />}
      <div className={styles.hero}>
        <h1>{access?.role === 'super' ? t("MU TRACE platform yönetimi") : t("Ürün izlenebilirliği")}</h1>
        <p>{access ? `${t(traceRoles[access.role])} · ${displayName ?? email}` : t("Barkoddan lota, ürün hareketlerinden kontrol ve onay geçmişine.")}</p>
      </div>
      {!access ? <section className={styles.card} aria-labelledby="trace-login">
        <h2 id="trace-login">{t("MU TRACE hesabınızla giriş yapın")}</h2>
        {loginError && <p className={styles.error} role="alert">{t(loginError)}</p>}
        {challengeId ? <form className={`${styles.form} ${styles.loginForm}`} method="post" action="/api/trace/login">
          <label>{t("Kullanıcı adı veya e-posta")}<input name="email" type="email" autoComplete="username" maxLength={100} required /></label>
          <label>{t("Şifre")}<input name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
          <label>{t("Görseldeki beş harf")}<input name="challengeAnswer" autoComplete="off" pattern="[A-Za-z]{5}" maxLength={5} required /></label>
          <div className={styles.challenge}>
            <img src={`/admin/challenge/${challengeId}.bmp`} width="160" height="48" alt={t("Beş harfli doğrulama görseli")} />
            <a href={mobile ? '/trace?mobil=1' : '/trace'}>{t("Harfleri yenile")}</a>
          </div>
          <input type="hidden" name="challengeId" value={challengeId} />
          {mobile && <input type="hidden" name="mobil" value="1" />}
          <button>{t("MU TRACE’e giriş yap")}</button>
        </form> : <p role="status">{t("Veritabanı bağlantısı kurulamadı.")}</p>}
        <p>{t("Mevcut MuTerminal hesabınız için panel girişi")}</p>
        <div className={styles.actions}>
          <a className={styles.primaryLink} href={`/?panel=staff${mobileParam}#admin-giris`}>{t("Personel girişi")}</a>
          <a className={styles.primaryLink} href={`/?panel=manager${mobileParam}#admin-giris`}>{t("Yönetici girişi")}</a>
          <a className={styles.primaryLink} href={`/?panel=admin${mobileParam}#admin-giris`}>{t("Admin girişi")}</a>
        </div>
      </section> : <>
        {!mobile && <nav className={styles.tabs} aria-label={t("MU TRACE bölümleri")}>
          {canLookup && <button aria-pressed={tab === 'lookup'} disabled={busy} onClick={() => { setTab('lookup'); setError(''); setNotice(''); }}>{t("Ürün sorgula")}</button>}
          {canLookup && <button aria-pressed={tab === 'report'} disabled={busy} onClick={() => void run(async () => {
            setTab('report');
            setReport(await api<TraceReport | PersonalReport>('/api/trace/report'));
          })}>{access.role === 'staff' ? t("Kontrol özetim") : t("Rapor ve geri çağırmalar")}</button>}
          {access.canManage && <button aria-pressed={tab === 'management'} disabled={busy}
            onClick={() => { setTab('management'); setError(''); setNotice(''); }}>{t("Yönetim")}</button>}
        </nav>}
        {error && <p className={styles.error} role="alert">{t(error)}</p>}
        <p className={styles.status} role="status">{busy ? t("İşlem sürüyor…") : t(notice)}</p>
        {tab === 'management' ? <TraceManagement access={access} /> : tab === 'report' ? report && <Reporting report={report} openLot={lookup} /> : <>
          <section className={styles.card} aria-labelledby="trace-search">
            <h2 id="trace-search">{t("Barkod veya QR sorgula")}</h2>
            <form className={styles.search} onSubmit={event => { event.preventDefault(); lookup(code.trim(), filterLot.trim()); }}>
              <label>{t("Barkod, ürün kodu veya GS1 Digital Link")}<input value={code} onChange={event => setCode(event.target.value)} maxLength={512} autoComplete="off" required /></label>
              <label><span>{t("Lot") + " "}<small className={styles.muted}>{t("(isteğe bağlı)")}</small></span><input value={filterLot} onChange={event => setFilterLot(event.target.value)} maxLength={80} autoComplete="off" /></label>
              <button disabled={busy}>{t("Sorgula")}</button>
              <TraceCamera disabled={busy} onRead={value => lookup(value, '')} />
            </form>
          </section>
          {lots?.length === 0 && <p className={styles.empty}>{t("Bu kod ve lot için erişebileceğiniz bir kayıt bulunamadı.")}</p>}
          {current && <div className={styles.workspace}>
            <section className={`${styles.card} ${styles.identity}`} aria-labelledby="trace-product">
              {lots && lots.length > 1 && <label>{t("Ürün, lot ve mağaza")}<select value={selected} onChange={event => setSelected(event.target.value)} disabled={busy}>
                {lots.map(lot => <option key={lotKey(lot)} value={lotKey(lot)}>{lot.name} · {lot.lot} · {t(lot.storeName)}</option>)}
              </select></label>}
              <h2 id="trace-product">{current.name}</h2>
              <dl className={styles.details}>
                <div><dt>{t("Barkod")}</dt><dd>{current.barcode}</dd></div><div><dt>{t("Lot")}</dt><dd>{current.lot}</dd></div>
                <div><dt>{t("Mağaza")}</dt><dd>{t(current.storeName)}</dd></div>
                <div><dt>{t("SKT")}</dt><dd>{current.expiryDates.length ? current.expiryDates.join(' / ') : t("Kayıt yok")}</dd></div>
                <div><dt>{t("RKS")}</dt><dd>{current.rksBlocked ? t("Blokaj kayıtlı") : t("Blokaj kaydı bulunamadı")}</dd></div>
              </dl>
              {activeRecall && <p className={styles.error}><strong>{t("Açık geri çağırma")}</strong><br />{activeRecall.note}</p>}
              {canScan && productId && <p><a href={`/staff/scan?code=${encodeURIComponent(current.barcode)}&lot=${encodeURIComponent(current.lot)}${mobileParam}`}>{t("MuTerminal Scan ile fiziksel kontrol")}</a></p>}
              {productId && access.stages.length > 0 && <MovementForm key={`movement-${productId}`} productId={productId} stages={access.stages} busy={busy} submit={submit} />}
              {access.canRecall && (activeRecall || productId) && <RecallForm key={`recall-${activeRecall?.id ?? productId}`} productId={productId} recall={activeRecall} busy={busy} submit={submit} />}
              {productId && current.warehouses.length > 0 && <details className={styles.disclosure}>
                <summary>{t("Depo lot ataması")}</summary>
                <form className={styles.form} onSubmit={event => {
                  event.preventDefault();
                  const fields = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
                  const enabled = fields.get('assignment') === 'assign';
                  void submit('/api/trace/warehouse-lots', { productId, warehouseId: fields.get('warehouseId'), enabled },
                    enabled ? 'Lot depoya atandı.' : 'Lotun depo ataması kaldırıldı.');
                }}>
                  <label>{t("Depo")}<select name="warehouseId" defaultValue="" required>
                    <option value="" disabled>{t("Depo seçin")}</option>
                    {current.warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{t(warehouse.name)}</option>)}
                  </select></label>
                  <div className={styles.actions}><button name="assignment" value="assign" disabled={busy}>{t("Lotu ata")}</button>
                    <button className={styles.secondary} name="assignment" value="remove" disabled={busy}>{t("Atamayı kaldır")}</button></div>
                </form>
              </details>}
            </section>
            <section className={styles.card} aria-labelledby="trace-journey">
              <h2 id="trace-journey">{t("Dijital yolculuk")}</h2>
              <ol className={styles.stages}>{Object.entries(traceStages).map(([stage, label]) => {
                const recorded = current.events.some(event => event.stage === stage);
                return <li key={stage} data-recorded={recorded}><strong>{t(label)}</strong><span>{recorded ? t("Kayıt var") : t("Kayıt yok")}</span></li>;
              })}</ol>
              <p className={styles.muted}>{t("Yolculuğun kapsamı erişilebilen veriye ve entegrasyonlara bağlıdır.")}</p>
              <h3>{t("Hareket ve karar geçmişi")}</h3>
              <Timeline lot={current} />
            </section>
            <section className={`${styles.card} ${styles.operations}`} aria-labelledby="trace-controls">
              <h2 id="trace-controls">{t("MU TRACE kontrolleri ve karar talepleri")}</h2>
              {access.canControl && productId && <>
                <p className={styles.muted}>{t("Satışa açma işlemi yetkili kaynak sistemde ve kalite kontrolleriyle doğrulanır.")}</p>
                <ControlForm key={productId} productId={productId} access={access} busy={busy} submit={submit} />
              </>}
              {current.controls.length > 0 ? <div className={styles.controlList}>
                {current.controls.map(control => <ControlDetails key={control.id} control={control} access={access}
                  email={email} productId={productId} busy={busy} submit={submit} />)}
              </div> : <p>{t("Bu lot için görünür MU TRACE kontrolü bulunmuyor.")}</p>}
            </section>
            <section className={`${styles.card} ${styles.operations}`} aria-labelledby="trace-operations">
              <h2 id="trace-operations">{t("Operasyonlar ve kontroller")}</h2>
              {current.operations.length ? current.operations.map(operation =>
                <Operation key={operation.id} operation={operation} />) : <p>{t("Bu lot için CORE operasyon kaydı bulunmuyor.")}</p>}
            </section>
          </div>}
        </>}
      </>}
    </main>
    {mobile && access && <MobileNav current={tab} canLookup={canLookup} canManage={access.canManage} personal={access.role === 'staff'} />}
  </div>;
}
