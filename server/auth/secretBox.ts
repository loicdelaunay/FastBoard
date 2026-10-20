import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Chiffrement symétrique (AES-256-GCM) des secrets qu'il faut pouvoir réafficher, comme les jetons d'API.
 * La clé vit dans un fichier à côté de la base (`secret.key`) : une copie de la base seule ne suffit pas à lire les
 * secrets. Une base en mémoire (tests) utilise une clé éphémère.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(dbPath: string) {
    this.key = dbPath === ':memory:' ? randomBytes(32) : loadOrCreateKey(path.join(path.dirname(dbPath), 'secret.key'));
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  /** `null` si le secret a été chiffré avec une autre clé ou est illisible. */
  open(sealed: string): string | null {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined) {
      return null;
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

function loadOrCreateKey(file: string): Buffer {
  try {
    const existing = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (existing.length === 32) {
      return existing;
    }
  } catch {
    // Pas encore de clé : on la crée ci-dessous.
  }
  const key = randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}
