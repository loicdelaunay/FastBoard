import fs from 'node:fs';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const deflateRaw = promisify(zlib.deflateRaw);
const MAX_ZIP32 = 0xffff_fffe;

interface Entry {
  name: Buffer;
  crc: number;
  compressedSize: number;
  size: number;
  method: number;
  time: number;
  date: number;
  offset: number;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Écrit une archive ZIP fichier par fichier (sans charger toute l'archive en mémoire).
 * Format ZIP classique : jusqu'à 4 Go et 65 535 fichiers, ce qui couvre largement une base FastBoard.
 */
export class ZipWriter {
  private readonly fd: number;
  private offset = 0;
  private readonly entries: Entry[] = [];

  constructor(file: string) {
    this.fd = fs.openSync(file, 'w');
  }

  private write(buffer: Buffer): void {
    fs.writeSync(this.fd, buffer);
    this.offset += buffer.length;
    if (this.offset > MAX_ZIP32) {
      throw new Error("L'archive dépasse 4 Go : format non pris en charge.");
    }
  }

  async add(name: string, data: Buffer, modified = new Date()): Promise<void> {
    if (this.entries.length >= 65_535) {
      throw new Error("Trop de fichiers pour une seule archive (65 535 au maximum).");
    }
    const compressed = data.length > 0 ? await deflateRaw(data, { level: 6 }) : data;
    // Un fichier déjà compressé (image, PDF…) peut grossir : on le stocke tel quel.
    const store = compressed.length >= data.length;
    const body = store ? data : compressed;
    const entry: Entry = {
      name: Buffer.from(name, 'utf8'),
      crc: zlib.crc32(data) >>> 0,
      compressedSize: body.length,
      size: data.length,
      method: store ? 0 : 8,
      ...dosDateTime(modified),
      offset: this.offset,
    };
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // noms en UTF-8
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(entry.time, 10);
    header.writeUInt16LE(entry.date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressedSize, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(entry.name.length, 26);
    header.writeUInt16LE(0, 28);
    this.write(header);
    this.write(entry.name);
    this.write(body);
    this.entries.push(entry);
  }

  close(): void {
    const start = this.offset;
    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.time, 12);
      header.writeUInt16LE(entry.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressedSize, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt32LE(entry.offset, 42);
      this.write(header);
      this.write(entry.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
    fs.closeSync(this.fd);
  }

  /** Abandonne l'archive (fichier partiel laissé à l'appelant). */
  abort(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      // Déjà fermé.
    }
  }
}

/** Lit la liste et le contenu des fichiers d'une archive écrite par `ZipWriter` (tests, restauration). */
export function readZip(file: string): Map<string, Buffer> {
  const data = fs.readFileSync(file);
  const endOffset = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) {
    throw new Error('Archive ZIP invalide.');
  }
  const count = data.readUInt16LE(endOffset + 10);
  let cursor = data.readUInt32LE(endOffset + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const method = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const bodyStart = localOffset + 30 + localNameLength + localExtraLength;
    const body = data.subarray(bodyStart, bodyStart + compressedSize);
    files.set(name, method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
