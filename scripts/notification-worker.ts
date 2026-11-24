import { loadEnvConfig } from '@next/env';
import { setTimeout } from 'node:timers/promises';
import { dispatchNotifications, pushConfiguration } from '../server/notifications';
import { pool } from '../server/database';

async function run() {
  loadEnvConfig(process.cwd());
  if (!pushConfiguration()) {
    console.log('MuTerminal bildirim gönderimi kapalı veya Web Push yapılandırması eksik.');
    return;
  }
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  process.once('SIGTERM', () => stop.abort());
  while (!stop.signal.aborted) {
    let delay = 10_000;
    try {
      const { processed } = await dispatchNotifications();
      if (processed === 16) delay = 100;
    } catch {
      console.error('MuTerminal bildirim kuyruğu işlenemedi.');
      delay = 30_000;
    }
    await setTimeout(delay, undefined, { signal: stop.signal }).catch(() => {});
  }
  await pool().end();
}

void run().catch(() => {
  console.error('MuTerminal bildirim süreci başlatılamadı.');
  process.exitCode = 1;
});
