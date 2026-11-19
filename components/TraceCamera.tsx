import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import styles from './Trace.module.css';

export default function TraceCamera({ onRead, disabled }: { onRead: (value: string) => void; disabled: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const read = useRef(onRead);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { read.current = onRead; }, [onRead]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let matched = false;
    let stream: MediaStream | undefined;
    let controls: IScannerControls | undefined;
    const element = video.current;
    if (!element) return;

    async function start(target: HTMLVideoElement) {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Bu tarayıcıda kamera okuma kullanılamıyor. Harici okuyucuyu veya kod alanını kullanın.');
        }
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (stopped) return;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
        if (stopped) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromStream(stream, target, result => {
          if (stopped || matched || !result) return;
          const value = result.getText();
          if (!value) return;
          matched = true;
          setOpen(false);
          read.current(value);
        });
        if (stopped) controls.stop();
      } catch (failure) {
        if (stopped) return;
        setError(failure instanceof DOMException ? 'Kamera açılamadı. Kamera iznini kontrol edin veya kodu girin.'
          : failure instanceof Error ? failure.message : 'Kamera açılamadı.');
        setOpen(false);
      }
    }
    void start(element);
    return () => {
      stopped = true;
      controls?.stop();
      stream?.getTracks().forEach(track => track.stop());
      element.srcObject = null;
    };
  }, [open]);

  return <>
    <button type="button" className={styles.secondary} disabled={disabled && !open} onClick={() => { setError(''); setOpen(!open); }}>
      {open ? 'Kamerayı kapat' : 'Kamerayla oku'}
    </button>
    {open && <video className={styles.camera} ref={video} muted playsInline aria-label="Barkod ve QR okuma kamerası" />}
    {error && <p className={styles.error} role="status">{error}</p>}
  </>;
}
