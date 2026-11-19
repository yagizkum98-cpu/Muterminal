const { randomBytes, randomInt } = require('node:crypto');

// Five-column bitmap glyphs with distinct forms for the letters used in the code.
const glyphs = {
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
  V: [17, 17, 17, 17, 10, 10, 4],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};
const alphabet = Object.keys(glyphs);
const challenges = new Map();
const codeLength = 5;
const lifetime = 5 * 60 * 1000;
const maxChallenges = 512;

function renderCode(letters) {
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

function createChallenge() {
  const now = Date.now();
  for (const [id, challenge] of challenges) {
    if (challenge.expires > now) break;
    challenges.delete(id);
  }
  if (challenges.size >= maxChallenges) challenges.delete(challenges.keys().next().value);
  const id = randomBytes(16).toString('hex');
  const letters = Array.from({ length: codeLength }, () => alphabet[randomInt(alphabet.length)]);
  challenges.set(id, { code: letters.join(''), image: renderCode(letters), expires: now + lifetime });
  return id;
}

function challengeImage(id) {
  const challenge = challenges.get(id);
  return challenge && challenge.expires > Date.now() ? challenge.image : undefined;
}

function verifyChallenge(id, answer) {
  const challenge = challenges.get(id);
  challenges.delete(id);
  return Boolean(challenge && challenge.expires > Date.now() && challenge.code === answer?.trim().toUpperCase());
}

module.exports = { createChallenge, challengeImage, verifyChallenge };
