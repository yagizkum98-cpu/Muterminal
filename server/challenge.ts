import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { ensureSchema, query, transaction } from './database';

// Five-column bitmap glyphs with distinct forms for the letters used in the code.
const glyphs: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  C: [14, 17, 16, 16, 16, 17, 14],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  H: [17, 17, 17, 31, 17, 17, 17],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  R: [30, 17, 17, 30, 20, 18, 17],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 10, 10, 4, 4],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};
const alphabet = Object.keys(glyphs);
const codeLength = 5;
const lifetime = 5 * 60 * 1000;

export async function allowLoginRequest(request: IncomingMessage, action: 'issue' | 'attempt') {
  const forwarded = process.env.VERCEL === '1' ? request.headers['x-vercel-forwarded-for'] : undefined;
  const forwardedIp = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  const ip = (isIP(forwardedIp) ? forwardedIp : request.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
  const key = createHash('sha256').update(`${action}:${ip}`).digest('hex');
  const { rowCount } = await query(`
    INSERT INTO login_limits (key, attempts, expires_at)
    VALUES ($1, 1, now() + interval '5 minutes')
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN login_limits.expires_at <= now() THEN 1 ELSE login_limits.attempts + 1 END,
      expires_at = CASE WHEN login_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE login_limits.expires_at END
    WHERE login_limits.expires_at <= now() OR login_limits.attempts < $2
  `, [key, action === 'issue' ? 90 : 15]);
  return rowCount === 1;
}

function renderCode(letters: string[]) {
  const width = 160;
  const height = 48;
  const headerSize = 54;
  const rowSize = width * 3; // 24-bit BGR, with width chosen for four-byte row alignment.
  const image = Buffer.alloc(headerSize + rowSize * height, 245);
  image.fill(0, 0, headerSize);
  image.write('BM');
  image.writeUInt32LE(image.length, 2);
  image.writeUInt32LE(headerSize, 10);
  image.writeUInt32LE(40, 14);
  image.writeInt32LE(width, 18);
  image.writeInt32LE(-height, 22);
  image.writeUInt16LE(1, 26);
  image.writeUInt16LE(24, 28);
  image.writeUInt32LE(rowSize * height, 34);

  for (let index = 0; index < 280; index++) {
    const offset = headerSize + randomInt(width * height) * 3;
    image.fill(randomInt(145, 215), offset, offset + 3);
  }

  for (const [index, letter] of letters.entries()) {
    const left = 12 + index * 29 + randomInt(-2, 3);
    const top = randomInt(7, 14);
    const slant = randomInt(-1, 2);
    for (const [row, bits] of glyphs[letter].entries()) {
      for (let column = 0; column < 5; column++) {
        if ((bits & (16 >> column)) === 0) continue;
        const x = left + column * 4 + Math.floor(row / 2) * slant;
        for (let dy = 0; dy < 4; dy++) {
          const offset = headerSize + (top + row * 4 + dy) * rowSize + x * 3;
          image.fill(36, offset, offset + 12);
        }
      }
    }
  }
  return image;
}

const hashCode = (answer: string) => createHash('sha256').update(answer).digest('hex');

export type IssuedChallenge = { id: string; expiresIn: number };

export async function createChallenge(request: IncomingMessage): Promise<IssuedChallenge | null> {
  if (!await allowLoginRequest(request, 'issue')) return null;
  const id = randomBytes(16).toString('hex');
  const letters = Array.from({ length: codeLength }, () => alphabet[randomInt(alphabet.length)]);
  await ensureSchema();
  await transaction(async client => {
    await client.query('DELETE FROM login_challenges WHERE expires_at <= now()');
    await client.query('DELETE FROM login_limits WHERE expires_at <= now()');
    await client.query('INSERT INTO login_challenges VALUES ($1, $2, $3, $4)', [id, hashCode(letters.join('')), renderCode(letters), new Date(Date.now() + lifetime)]);
  });
  return { id, expiresIn: lifetime };
}

export async function challengeImage(id: string) {
  const { rows } = await query<{ image: Buffer }>('SELECT image FROM login_challenges WHERE id = $1 AND expires_at > now()', [id]);
  return rows[0]?.image;
}

export async function verifyChallenge(id: string | null, answer: string | null) {
  if (!id || !/^[0-9a-f]{32}$/.test(id)) return false;
  const { rows } = await query<{ code: string }>('DELETE FROM login_challenges WHERE id = $1 AND expires_at > now() RETURNING code', [id]);
  const normalized = answer?.trim().toUpperCase();
  return Boolean(rows[0] && normalized && /^[A-Z]{5}$/.test(normalized) && rows[0].code === hashCode(normalized));
}
