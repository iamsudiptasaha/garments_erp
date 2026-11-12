import { createHmac } from 'node:crypto';

export function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = Array.from(secret.replace(/=+$/, ''), (letter) =>
    alphabet.indexOf(letter).toString(2).padStart(5, '0'),
  ).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', key).update(counter).digest();
  return String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
