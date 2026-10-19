import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const COST = 16384;

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N: cost, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

/** Format : `scrypt$<N>$<sel base64>$<empreinte base64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return `scrypt$${COST}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !cost || !saltB64 || !keyB64) {
    return false;
  }
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), Number(cost));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

let dummyHash: Promise<string> | null = null;

/** Compare à une empreinte factice pour garder un temps de réponse constant quand le compte n'existe pas. */
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword('fastboard-dummy-password');
  await verifyPassword(password, await dummyHash);
}
