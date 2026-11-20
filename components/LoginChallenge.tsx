import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import type { IssuedChallenge } from '../server/challenge';
import { useTranslate } from './LanguagePicker';

export default function LoginChallenge({ initial, refreshHref, imageClassName }: {
  initial: IssuedChallenge;
  refreshHref: string;
  imageClassName: string;
}) {
  const t = useTranslate();
  const answerId = useId();
  const answer = useRef<HTMLInputElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [challenge, setChallenge] = useState(initial);
  const [problem, setProblem] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setProblem('Doğrulama kodunun süresi doldu. Harfleri yenileyin.'), challenge.expiresIn);
    if (image.current?.complete && !image.current.naturalWidth) {
      setProblem('Doğrulama görseli yüklenemedi. Harfleri yenileyin.');
    }
    return () => window.clearTimeout(timer);
  }, [challenge]);

  useEffect(() => {
    answer.current?.setCustomValidity(t(problem));
  }, [problem, t]);

  async function refresh(event: MouseEvent<HTMLAnchorElement>) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError('');
    try {
      const response = await fetch('/api/session/challenge', { method: 'POST' });
      if (response.status === 429) {
        setRefreshError('Çok fazla doğrulama isteği gönderildi. Biraz bekleyip tekrar deneyin.');
        return;
      }
      if (!response.ok) throw new Error();
      const next: IssuedChallenge = await response.json();
      setProblem('');
      setChallenge(next);
      if (answer.current) {
        answer.current.value = '';
        answer.current.focus();
      }
    } catch {
      setRefreshError('Doğrulama kodu yenilenemedi. Tekrar deneyin.');
    } finally {
      setRefreshing(false);
    }
  }

  return <>
    <label htmlFor={answerId}>{t("Görseldeki beş harfi yazın")}</label>
    <div className={imageClassName} aria-busy={refreshing}>
      <img key={challenge.id} ref={image} src={`/admin/challenge/${challenge.id}.bmp`} width="160" height="48"
        alt={t("Beş harfli doğrulama görseli")}
        onError={() => setProblem('Doğrulama görseli yüklenemedi. Harfleri yenileyin.')} />
      <a href={refreshHref} onClick={refresh}>{t("Harfleri yenile")}</a>
    </div>
    {problem && <p role="status">{t(problem)}</p>}
    {refreshError && <p role="alert">{t(refreshError)}</p>}
    <input type="hidden" name="challengeId" value={challenge.id} />
    <input ref={answer} id={answerId} name="challengeAnswer" type="text" autoComplete="off" spellCheck={false}
      autoCapitalize="characters" pattern="[A-Za-z]{5}" maxLength={5} required />
  </>;
}
