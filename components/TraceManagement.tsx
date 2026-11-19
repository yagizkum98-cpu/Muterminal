import { useLanguage, useTranslate } from './LanguagePicker';
import { useEffect, useState, type FormEvent } from 'react';
import { traceRoles, traceRoleSummaries, type TraceAccess, type TraceRole } from './trace-policy';
import styles from './Trace.module.css';

type Location = { id: string; name: string };
type User = {
  email: string; displayName: string; active: boolean; role: TraceRole; tenantId: string;
  storeId: string | null; warehouseId: string | null; control: boolean; review: boolean;
};
type Management = {
  tenants: Location[]; users: User[]; stores: Location[]; warehouses: (Location & { storeId: string })[];
  warningDays: number; history: { actor: string; action: string; target: string; time: string }[];
  mobileStaff: { email: string; name: string; source: 'core' | 'trace'; storeId: string; assigned: boolean }[];
};

export default function TraceManagement({ access }: { access: TraceAccess }) {
  const t = useTranslate();
  const locale = useLanguage() === 'en' ? 'en-GB' : 'tr-TR';
  const [data, setData] = useState<Management>();
  const [editing, setEditing] = useState<User>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [issuedCode, setIssuedCode] = useState<{ email: string; code: string }>();
  const roles: TraceRole[] = access.role === 'super' ? ['company'] : access.role === 'manager' ? ['staff'] : ['manager', 'warehouse', 'staff', 'auditor'];
  const [role, setRole] = useState(roles[0]);
  const [storeId, setStoreId] = useState('');
  const tenantNames = new Map(data?.tenants.map(tenant => [tenant.id, tenant.name]));
  const stores = new Map(data?.stores.map(store => [store.id, store.name]));
  const warehouses = new Map(data?.warehouses.map(warehouse => [warehouse.id, warehouse.name]));

  async function load() {
    const response = await fetch('/api/trace/management');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setData(result);
  }

  useEffect(() => {
    void load().catch(failure => setError(failure.message));
  }, []);

  async function change(action: string, body: object, onSaved?: (result: { code?: string | null }) => void) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/trace/management/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved?.(result);
      await load();
      setMessage('Değişiklik kaydedildi.');
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'İşlem tamamlanamadı.');
      return false;
    } finally { setBusy(false); }
  }

  function edit(user?: User) {
    setEditing(user);
    setRole(user?.role ?? roles[0]);
    setStoreId(user?.storeId ?? '');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (await change(editing ? 'permissions' : 'users', {
      ...Object.fromEntries(values), email: editing?.email ?? values.get('email'),
      control: values.has('control'), review: values.has('review'),
    })) {
      form.reset();
      edit();
    }
  }

  function locationForm(action: 'tenants' | 'stores' | 'warehouses', label: string) {
    return <details className={styles.disclosure}>
      <summary>{t('{location} oluştur', { location: t(label) })}</summary>
      <form className={styles.form} onSubmit={async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (await change(action, Object.fromEntries(new FormData(form)))) form.reset();
      }}>
        <div className={styles.fields}>
          <label>{t('{location} adı', { location: t(label) })}<input name="name" maxLength={100} required /></label>
          <label>{t('{location} kodu', { location: t(label) })}<input name="id" pattern="[a-z0-9][a-z0-9\-]*" maxLength={50} required /></label>
        </div>
        {action === 'warehouses' && <label>{t("Mağaza")}<select name="storeId" defaultValue="" required>
          <option value="" disabled>{t("Mağaza seçin")}</option>
          {data?.stores.map(store => <option key={store.id} value={store.id}>{t(store.name)}</option>)}
        </select></label>}
        <button disabled={busy}>{t("Kaydet")}</button>
      </form>
    </details>;
  }

  return <div className={styles.report}>
    {error && <p role="alert" className={styles.error}>{t(error)}</p>}
    {message && <p role="status" className={styles.status}>{t(message)}</p>}
    {!data ? !error && <p role="status">{t("Yönetim bilgileri yükleniyor…")}</p> : <>
      <section className={styles.card} aria-labelledby="trace-users">
        <h2 id="trace-users">{t("MU TRACE kullanıcıları")}</h2>
        {data.users.length > 0 && <ul className={styles.resultList}>{data.users.map(user => <li key={user.email}>
          <strong>{user.displayName} · {t(traceRoles[user.role])}</strong>
          <p>{user.email} · {tenantNames.get(user.tenantId) ?? user.tenantId}
            {user.storeId && ` · ${t(stores.get(user.storeId) ?? user.storeId)}`}{user.warehouseId && ` · ${t(warehouses.get(user.warehouseId) ?? user.warehouseId)}`}
            {' · '}{user.active ? t("Etkin") : t("Devre dışı")}</p>
          <div className={styles.actions}>
            <button className={styles.secondary} type="button" onClick={() => edit(user)}>{t("Kapsamı düzenle")}</button>
            <button className={styles.secondary} type="button" disabled={busy} onClick={() => void change('status', { email: user.email, active: !user.active })}>
              {user.active ? t("Devre dışı bırak") : t("Etkinleştir")}</button>
          </div>
          <details className={styles.disclosure}>
            <summary>{t("Şifre yenile")}</summary>
            <form className={styles.form} onSubmit={async event => {
              event.preventDefault();
              const form = event.currentTarget;
              if (await change('password', { email: user.email, password: new FormData(form).get('password') })) form.reset();
            }}>
              <label>{t("Yeni şifre")}<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
              <button disabled={busy}>{t("Şifreyi kaydet")}</button>
            </form>
          </details>
        </li>)}</ul>}
        <h3>{editing ? t('{email} kapsamı', { email: editing.email }) : t("Yeni kullanıcı")}</h3>
        <form className={styles.form} onSubmit={save} key={editing?.email ?? 'new-user'}>
          <div className={styles.fields}>
            <label>{t("Ad soyad")}<input name="displayName" defaultValue={editing?.displayName} maxLength={100} required /></label>
            {!editing && <><label>{t("E-posta")}<input name="email" type="email" maxLength={100} required /></label>
              <label>{t("Başlangıç şifresi")}<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label></>}
            <label>{t("Rol")}<select name="role" value={role} onChange={event => { setRole(event.target.value as TraceRole); setStoreId(''); }}>
              {roles.map(value => <option key={value} value={value}>{t(traceRoles[value])}</option>)}
            </select></label>
            {access.role === 'super' && <label>{t("Firma")}<select name="tenantId" defaultValue={editing?.tenantId ?? ''} required>
              <option value="" disabled>{t("Firma seçin")}</option>
              {data.tenants.map(tenant => <option value={tenant.id} key={tenant.id}>{tenant.name}</option>)}
            </select></label>}
            {role !== 'company' && <label>{t("Mağaza")}<select name="storeId" value={storeId} required={role !== 'auditor'}
              onChange={event => setStoreId(event.target.value)}>
              <option value="" disabled={role !== 'auditor'}>{role === 'auditor' ? t("Firma kapsamı") : t("Mağaza seçin")}</option>
              {data.stores.map(store => <option key={store.id} value={store.id}>{t(store.name)}</option>)}
            </select></label>}
            {role === 'warehouse' && <label>{t("Depo")}<select key={storeId} name="warehouseId" defaultValue={editing?.storeId === storeId ? editing?.warehouseId ?? '' : ''} required>
              <option value="" disabled>{t("Depo seçin")}</option>
              {data.warehouses.filter(warehouse => warehouse.storeId === storeId).map(warehouse => <option key={warehouse.id} value={warehouse.id}>{t(warehouse.name)}</option>)}
            </select></label>}
          </div>
          <p className={styles.muted}>{t(traceRoleSummaries[role])}</p>
          {role === 'company' && <div className={styles.actions}>
            <label className={styles.check}><input name="control" type="checkbox" defaultChecked={editing?.control} />{" " + t("Manuel kontrol ve talep yetkisi")}</label>
            <label className={styles.check}><input name="review" type="checkbox" defaultChecked={editing?.review} />{" " + t("Karar ve geri çağırma yetkisi")}</label>
          </div>}
          <div className={styles.actions}><button disabled={busy}>{editing ? t("Kapsamı kaydet") : t("Kullanıcıyı oluştur")}</button>
            {editing && <button className={styles.secondary} type="button" onClick={() => edit()}>{t("Vazgeç")}</button>}</div>
        </form>
      </section>
      {access.role !== 'super' && <section className={styles.card} aria-labelledby="mobile-staff-title">
        <h2 id="mobile-staff-title">{t("Personel mobil onay kodları")}</h2>
        {issuedCode && <div className={styles.pending} role="status">
          <p>{t('{email} için yeni kod', { email: issuedCode.email })}</p>
          <p><code className={styles.approvalCode}>{issuedCode.code}</code></p>
          <p>{t("Kodu yalnızca ilgili personele iletin. Bu kod yeniden görüntülenemez.")}</p>
          <button type="button" className={styles.secondary} onClick={() => setIssuedCode(undefined)}>{t("Kodu gizle")}</button>
        </div>}
        {data.mobileStaff.length === 0 ? <p>{t("Kapsamınızda etkin personel bulunamadı.")}</p>
          : <ul className={styles.resultList}>{data.mobileStaff.map(person => <li key={`${person.source}:${person.email}`}>
            <strong>{person.name}</strong>
            <p>{person.email} · {t(stores.get(person.storeId) ?? person.storeId)} · {person.source === 'core' ? 'CORE' : 'MU TRACE'} · {person.assigned ? t("Kod tanımlı") : t("Mobil erişim kilitli")}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => {
                setIssuedCode(undefined);
                void change('mobile', { source: person.source, email: person.email, action: 'issue' }, ({ code }) => {
                  if (code) setIssuedCode({ email: person.email, code });
                });
              }}>{person.assigned ? t("Yeni kod oluştur") : t("Onay kodu oluştur")}</button>
              {person.assigned && <button type="button" className={styles.secondary} disabled={busy} onClick={() => {
                setIssuedCode(undefined);
                void change('mobile', { source: person.source, email: person.email, action: 'revoke' });
              }}>{t("Mobil erişimi kilitle")}</button>}
            </div>
          </li>)}</ul>}
      </section>}
      {access.role !== 'manager' && <section className={styles.card} aria-labelledby="trace-settings">
        <h2 id="trace-settings">{access.role === 'super' ? t("Firma yönetimi") : t("Lokasyonlar ve firma ayarları")}</h2>
        {access.role === 'super' ? <>
          <ul>{data.tenants.map(tenant => <li key={tenant.id}>{tenant.name} · {tenant.id}</li>)}</ul>
          {locationForm('tenants', 'Firma')}
        </> : <>
          <ul>{data.stores.map(store => <li key={store.id}>{t(store.name)}{data.warehouses.filter(warehouse => warehouse.storeId === store.id)
            .map(warehouse => ` · ${t(warehouse.name)} (${warehouse.id})`).join('')}</li>)}</ul>
          {locationForm('stores', 'Mağaza')}
          {locationForm('warehouses', 'Depo')}
        </>}
        <details className={styles.disclosure}>
          <summary>{access.role === 'super' ? t("Yeni firmalar için varsayılan SKT uyarısı") : t("SKT uyarı ayarı")}</summary>
          <form className={styles.form} onSubmit={event => {
            event.preventDefault();
            void change('settings', { warningDays: Number(new FormData(event.currentTarget).get('warningDays')) });
          }}>
            <label>{t("SKT uyarı süresi (gün)")}<input name="warningDays" type="number" min={0} max={90} defaultValue={data.warningDays} required /></label>
            <button disabled={busy}>{t("Uyarı ayarını kaydet")}</button>
          </form>
        </details>
      </section>}
      {data.history.length > 0 && <section className={styles.card} aria-labelledby="trace-admin-history">
        <h2 id="trace-admin-history">{t("Yönetim işlem geçmişi")}</h2>
        <ul className={styles.resultList}>{data.history.map((entry, index) => <li key={`${entry.time}-${index}`}>
          <strong>{t(entry.action)}</strong><p>{entry.target} · {entry.actor} · {new Date(entry.time).toLocaleString(locale, { timeZone: 'Europe/Istanbul' })}</p>
        </li>)}</ul>
      </section>}
    </>}
  </div>;
}
