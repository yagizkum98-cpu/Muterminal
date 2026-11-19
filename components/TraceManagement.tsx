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
};

export default function TraceManagement({ access }: { access: TraceAccess }) {
  const [data, setData] = useState<Management>();
  const [editing, setEditing] = useState<User>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
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

  async function change(action: string, body: object) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/trace/management/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error((await response.json()).error);
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
      <summary>{label} oluştur</summary>
      <form className={styles.form} onSubmit={async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (await change(action, Object.fromEntries(new FormData(form)))) form.reset();
      }}>
        <div className={styles.fields}>
          <label>{label} adı<input name="name" maxLength={100} required /></label>
          <label>{label} kodu<input name="id" pattern="[a-z0-9][a-z0-9\-]*" maxLength={50} required /></label>
        </div>
        {action === 'warehouses' && <label>Mağaza<select name="storeId" defaultValue="" required>
          <option value="" disabled>Mağaza seçin</option>
          {data?.stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select></label>}
        <button disabled={busy}>Kaydet</button>
      </form>
    </details>;
  }

  return <div className={styles.report}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.status}>{message}</p>}
    {!data ? !error && <p role="status">Yönetim bilgileri yükleniyor…</p> : <>
      <section className={styles.card} aria-labelledby="trace-users">
        <h2 id="trace-users">MU TRACE kullanıcıları</h2>
        {data.users.length > 0 && <ul className={styles.resultList}>{data.users.map(user => <li key={user.email}>
          <strong>{user.displayName} · {traceRoles[user.role]}</strong>
          <p>{user.email} · {tenantNames.get(user.tenantId) ?? user.tenantId}
            {user.storeId && ` · ${stores.get(user.storeId) ?? user.storeId}`}{user.warehouseId && ` · ${warehouses.get(user.warehouseId) ?? user.warehouseId}`}
            {' · '}{user.active ? 'Etkin' : 'Devre dışı'}</p>
          <div className={styles.actions}>
            <button className={styles.secondary} type="button" onClick={() => edit(user)}>Kapsamı düzenle</button>
            <button className={styles.secondary} type="button" disabled={busy} onClick={() => void change('status', { email: user.email, active: !user.active })}>
              {user.active ? 'Devre dışı bırak' : 'Etkinleştir'}</button>
          </div>
          <details className={styles.disclosure}>
            <summary>Şifre yenile</summary>
            <form className={styles.form} onSubmit={async event => {
              event.preventDefault();
              const form = event.currentTarget;
              if (await change('password', { email: user.email, password: new FormData(form).get('password') })) form.reset();
            }}>
              <label>Yeni şifre<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
              <button disabled={busy}>Şifreyi kaydet</button>
            </form>
          </details>
        </li>)}</ul>}
        <h3>{editing ? `${editing.email} kapsamı` : 'Yeni kullanıcı'}</h3>
        <form className={styles.form} onSubmit={save} key={editing?.email ?? 'new-user'}>
          <div className={styles.fields}>
            <label>Ad soyad<input name="displayName" defaultValue={editing?.displayName} maxLength={100} required /></label>
            {!editing && <><label>E-posta<input name="email" type="email" maxLength={100} required /></label>
              <label>Başlangıç şifresi<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label></>}
            <label>Rol<select name="role" value={role} onChange={event => { setRole(event.target.value as TraceRole); setStoreId(''); }}>
              {roles.map(value => <option key={value} value={value}>{traceRoles[value]}</option>)}
            </select></label>
            {access.role === 'super' && <label>Firma<select name="tenantId" defaultValue={editing?.tenantId ?? ''} required>
              <option value="" disabled>Firma seçin</option>
              {data.tenants.map(tenant => <option value={tenant.id} key={tenant.id}>{tenant.name}</option>)}
            </select></label>}
            {role !== 'company' && <label>Mağaza<select name="storeId" value={storeId} required={role !== 'auditor'}
              onChange={event => setStoreId(event.target.value)}>
              <option value="" disabled={role !== 'auditor'}>{role === 'auditor' ? 'Firma kapsamı' : 'Mağaza seçin'}</option>
              {data.stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select></label>}
            {role === 'warehouse' && <label>Depo<select key={storeId} name="warehouseId" defaultValue={editing?.storeId === storeId ? editing?.warehouseId ?? '' : ''} required>
              <option value="" disabled>Depo seçin</option>
              {data.warehouses.filter(warehouse => warehouse.storeId === storeId).map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select></label>}
          </div>
          <p className={styles.muted}>{traceRoleSummaries[role]}</p>
          {role === 'company' && <div className={styles.actions}>
            <label className={styles.check}><input name="control" type="checkbox" defaultChecked={editing?.control} /> Manuel kontrol ve talep yetkisi</label>
            <label className={styles.check}><input name="review" type="checkbox" defaultChecked={editing?.review} /> Karar ve geri çağırma yetkisi</label>
          </div>}
          <div className={styles.actions}><button disabled={busy}>{editing ? 'Kapsamı kaydet' : 'Kullanıcıyı oluştur'}</button>
            {editing && <button className={styles.secondary} type="button" onClick={() => edit()}>Vazgeç</button>}</div>
        </form>
      </section>
      {access.role !== 'manager' && <section className={styles.card} aria-labelledby="trace-settings">
        <h2 id="trace-settings">{access.role === 'super' ? 'Firma yönetimi' : 'Lokasyonlar ve firma ayarları'}</h2>
        {access.role === 'super' ? <>
          <ul>{data.tenants.map(tenant => <li key={tenant.id}>{tenant.name} · {tenant.id}</li>)}</ul>
          {locationForm('tenants', 'Firma')}
        </> : <>
          <ul>{data.stores.map(store => <li key={store.id}>{store.name}{data.warehouses.filter(warehouse => warehouse.storeId === store.id)
            .map(warehouse => ` · ${warehouse.name} (${warehouse.id})`).join('')}</li>)}</ul>
          {locationForm('stores', 'Mağaza')}
          {locationForm('warehouses', 'Depo')}
        </>}
        <details className={styles.disclosure}>
          <summary>{access.role === 'super' ? 'Yeni firmalar için varsayılan SKT uyarısı' : 'SKT uyarı ayarı'}</summary>
          <form className={styles.form} onSubmit={event => {
            event.preventDefault();
            void change('settings', { warningDays: Number(new FormData(event.currentTarget).get('warningDays')) });
          }}>
            <label>SKT uyarı süresi (gün)<input name="warningDays" type="number" min={0} max={90} defaultValue={data.warningDays} required /></label>
            <button disabled={busy}>Uyarı ayarını kaydet</button>
          </form>
        </details>
      </section>}
      {data.history.length > 0 && <section className={styles.card} aria-labelledby="trace-admin-history">
        <h2 id="trace-admin-history">Yönetim işlem geçmişi</h2>
        <ul className={styles.resultList}>{data.history.map((entry, index) => <li key={`${entry.time}-${index}`}>
          <strong>{entry.action}</strong><p>{entry.target} · {entry.actor} · {new Date(entry.time).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</p>
        </li>)}</ul>
      </section>}
    </>}
  </div>;
}
