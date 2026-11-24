import { useEffect, useState } from 'react';
import { useTranslate } from './LanguagePicker';
import { notificationCategories, type NotificationCategory } from '../lib/notification-categories';
import styles from './NotificationSettings.module.css';

const categoryKeys = Object.keys(notificationCategories) as NotificationCategory[];

function publicKeyBytes(value: string) {
  const data = atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(data, char => char.charCodeAt(0));
}

async function deviceId(subscription: PushSubscription) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

interface DeviceSettings {
  publicKey: string | null;
  categories: NotificationCategory[];
}

export default function NotificationSettings({ panel, mobile = false }: { panel: string; mobile?: boolean }) {
  const t = useTranslate();
  const [settings, setSettings] = useState<DeviceSettings>();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [supported, setSupported] = useState(true);
  const [selected, setSelected] = useState(categoryKeys);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = Boolean(settings?.categories.length);
  const changed = settings?.categories.length !== selected.length || selected.some(key => !settings.categories.includes(key));

  useEffect(() => {
    const controller = new AbortController();
    const headers = new Headers({ 'X-MuTerminal-Panel': panel, 'X-MuTerminal-Mobile': mobile ? '1' : '0' });
    const available = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(available);
    setSettings(undefined);
    setRegistration(undefined);
    setError('');
    void (async () => {
      try {
        const worker = available ? await navigator.serviceWorker.getRegistration('/') : undefined;
        const subscription = await worker?.pushManager.getSubscription();
        if (subscription) headers.set('X-MuTerminal-Push-Id', await deviceId(subscription));
        const response = await fetch('/api/notifications', { headers, signal: controller.signal });
        if (!response.ok) throw new Error();
        const saved: DeviceSettings = await response.json();
        if (controller.signal.aborted) return;
        setSettings(saved);
        setSelected(saved.categories.length ? saved.categories : categoryKeys);
        if (subscription && !saved.categories.length) await subscription.unsubscribe().catch(() => false);
        if (!available || (!saved.publicKey && !saved.categories.length)) return;
        if (saved.publicKey) await navigator.serviceWorker.register('/mu-notifications-sw.js', { scope: '/' });
        const current = saved.publicKey ? await navigator.serviceWorker.ready : worker;
        if (!controller.signal.aborted) setRegistration(current);
      } catch {
        if (!controller.signal.aborted) setError('Bildirim ayarları yüklenemedi.');
      }
    })();
    return () => controller.abort();
  }, [mobile, panel]);

  async function update(enable: boolean) {
    if (!settings || !registration || busy) return;
    const headers = new Headers({ 'X-MuTerminal-Panel': panel, 'X-MuTerminal-Mobile': mobile ? '1' : '0' });
    setBusy(true);
    setError('');
    let created: PushSubscription | undefined;
    try {
      if (enable && settings.publicKey) {
        if (Notification.permission === 'denied') {
          setError('Bildirim iznini cihaz ayarlarından açın.');
          return;
        }
        // On iOS this call must run directly in the button gesture.
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(settings.publicKey) });
        if (!active) created = subscription;
        headers.set('Content-Type', 'application/json');
        const response = await fetch('/api/notifications', { method: 'POST', headers,
          body: JSON.stringify({ ...subscription.toJSON(), categories: selected }) });
        if (!response.ok) throw new Error();
        setSettings({ ...settings, categories: selected });
      } else if (!enable) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          headers.set('X-MuTerminal-Push-Id', await deviceId(subscription));
          const response = await fetch('/api/notifications', { method: 'DELETE', headers });
          if (!response.ok) throw new Error();
          await subscription.unsubscribe().catch(() => false);
        }
        setSettings({ ...settings, categories: [] });
      }
    } catch {
      await created?.unsubscribe().catch(() => false);
      setError(Notification.permission === 'denied' ? 'Bildirim iznini cihaz ayarlarından açın.' : 'Bildirim ayarları kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  const enabled = Boolean(settings?.publicKey) && supported;
  return <details className={styles.card}>
    <summary>{t('Bildirimler')}<span>{t(active && enabled ? 'Açık' : 'Kapalı')}</span></summary>
    <div className={styles.body} aria-busy={busy}>
      {settings && !settings.publicKey && <p>{t('Bildirimler şu anda kapalı.')}</p>}
      {settings?.publicKey && !supported && <p>{t('Bu cihazda Web Push kullanılamıyor. iPhone veya iPad’de MuTerminal’i Ana Ekran’a ekleyip oradan açın.')}</p>}
      {enabled && <fieldset disabled={busy || !registration}>
        <legend>{t('Bildirim türleri')}</legend>
        {categoryKeys.map(key => <label key={key}>
          <input type="checkbox" checked={selected.includes(key)} onChange={event => {
            const checked = event.target.checked;
            setSelected(previous => checked ? [...previous, key] : previous.filter(category => category !== key));
          }} />{t(notificationCategories[key])}
        </label>)}
      </fieldset>}
      <div className={styles.actions}>
        {settings && (enabled || !settings.publicKey) && <button type="button" onClick={() => void update(true)}
          disabled={!enabled || !registration || busy || !selected.length || (active && !changed)}>
          {t(active ? 'Bildirim tercihlerini kaydet' : 'Bildirimleri aç')}
        </button>}
        {active && <button type="button" className={styles.secondary} onClick={() => void update(false)} disabled={!registration || busy}>{t('Bildirimleri kapat')}</button>}
      </div>
      {error && <p className={styles.error} role="alert">{t(error)}</p>}
    </div>
  </details>;
}
