import { useId, useState, type FormEvent } from 'react';
import { useTranslate } from './LanguagePicker';

export default function ChangePassword({ signIn, mobile = false }: { signIn: string; mobile?: boolean }) {
  const t = useTranslate();
  const id = useId();
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const endpoint = mobile ? '/api/session/password?mobil=1' : '/api/session/password';

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const credentials = Object.fromEntries(new FormData(event.currentTarget));
    setSaving(true);
    setStatus('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error);
      }
      window.location.replace(signIn);
    } catch (error) {
      setStatus(error instanceof Error && error.message ? error.message : 'İşlem tamamlanamadı.');
      setSaving(false);
    }
  }

  return <details>
    <summary>{t("Kendi şifremi değiştir")}</summary>
    <form className="management-form" method="post" action={endpoint} onSubmit={change}>
      <p>
        <label htmlFor={`${id}-current`}>{t("Mevcut şifre")}</label>{' '}
        <input id={`${id}-current`} name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required />
      </p>
      <p>
        <label htmlFor={`${id}-new`}>{t("Yeni şifre")}</label>{' '}
        <input id={`${id}-new`} name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
      </p>
      {status && <p role="alert">{t(status)}</p>}
      <button type="submit" disabled={saving}>{t("Kendi şifremi kaydet")}</button>
    </form>
  </details>;
}
