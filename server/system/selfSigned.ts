import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Certificat auto-signé (X.509 v3, RSA 2048, SHA-256) construit sans outil externe : pratique pour essayer HTTPS sur
 * le réseau local. Les navigateurs l'affichent comme « non sécurisé » tant qu'il n'est pas approuvé sur le poste.
 */

function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag: number, content: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), length(content.length), content]);
const sequence = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
const explicit = (index: number, content: Buffer): Buffer => tlv(0xa0 + index, content);

function integer(value: Buffer | number): Buffer {
  let bytes = typeof value === 'number' ? Buffer.from([value]) : value;
  if (bytes[0]! & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}

function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [first! * 40 + second!];
  for (const part of rest) {
    const chunk = [part & 0x7f];
    for (let value = part >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  // UTCTime jusqu'en 2049, GeneralizedTime ensuite (RFC 5280).
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

const name = (commonName: string): Buffer => sequence(set(sequence(oid('2.5.4.3'), tlv(0x0c, Buffer.from(commonName, 'utf8')))));

function ipBytes(address: string): Buffer {
  if (isIP(address) === 4) return Buffer.from(address.split('.').map(Number));
  // IPv6 : forme développée.
  const [head, tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return Buffer.concat(groups.map((group) => Buffer.from(group.padStart(4, '0'), 'hex')));
}

function pem(label: string, der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

export function createSelfSignedCertificate(hostnames: string[], days = 825, now = new Date()): { cert: string; key: string } {
  const names = [...new Set(hostnames.map((entry) => entry.trim()).filter(Boolean))];
  if (!names.length) names.push('localhost');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const algorithm = sequence(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));
  const alternatives = sequence(...names.map((entry) => (isIP(entry) ? tlv(0x87, ipBytes(entry)) : tlv(0x82, Buffer.from(entry, 'ascii')))));
  const critical = Buffer.from([0x01, 0x01, 0xff]);
  const extensions = sequence(
    sequence(oid('2.5.29.19'), critical, tlv(0x04, sequence())),
    sequence(oid('2.5.29.15'), critical, tlv(0x04, Buffer.from([0x03, 0x02, 0x05, 0xa0]))),
    sequence(oid('2.5.29.37'), tlv(0x04, sequence(oid('1.3.6.1.5.5.7.3.1')))),
    sequence(oid('2.5.29.17'), tlv(0x04, alternatives)),
  );
  const serial = randomBytes(16);
  serial[0]! &= 0x7f;
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + days * 86_400_000);
  const subject = name(names[0]!);
  const tbs = sequence(
    explicit(0, integer(2)),
    integer(serial),
    algorithm,
    subject,
    sequence(time(notBefore), time(notAfter)),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, extensions),
  );
  const signature = sign('sha256', tbs, privateKey);
  const certificate = sequence(tbs, algorithm, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return { cert: pem('CERTIFICATE', certificate), key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}
