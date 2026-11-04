import net from 'node:net';
import type { AddressInfo } from 'node:net';
import tls from 'node:tls';

/** Petit annuaire LDAP pour les tests : vrai protocole (BER) sur TCP ou TLS, limité à bind, search, StartTLS et unbind. */

export interface DirectoryEntry {
  dn: string;
  password: string;
  attributes: Record<string, string>;
}

interface Tlv {
  tag: number;
  value: Buffer;
}

function readTlv(buffer: Buffer, offset: number): (Tlv & { next: number }) | null {
  if (offset + 2 > buffer.length) return null;
  const tag = buffer[offset]!;
  let length = buffer[offset + 1]!;
  let start = offset + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    if (start + bytes > buffer.length) return null;
    length = buffer.subarray(start, start + bytes).reduce((sum, byte) => sum * 256 + byte, 0);
    start += bytes;
  }
  if (start + length > buffer.length) return null;
  return { tag, value: buffer.subarray(start, start + length), next: start + length };
}

function children(value: Buffer): Tlv[] {
  const list: Tlv[] = [];
  for (let offset = 0; offset < value.length; ) {
    const tlv = readTlv(value, offset);
    if (!tlv) break;
    list.push(tlv);
    offset = tlv.next;
  }
  return list;
}

function encode(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const length = body.length < 0x80 ? Buffer.from([body.length]) : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

const text = (value: string, tag = 0x04) => encode(tag, Buffer.from(value, 'utf8'));
const integer = (value: number, tag = 0x02) => encode(tag, Buffer.from([value]));
const result = (tag: number, code: number) => encode(tag, integer(code, 0x0a), text(''), text(''));

function matches(filter: Tlv, entry: DirectoryEntry): boolean {
  const attribute = (name: string) => Object.entries(entry.attributes).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  switch (filter.tag) {
    case 0xa0:
      return children(filter.value).every((part) => matches(part, entry));
    case 0xa1:
      return children(filter.value).some((part) => matches(part, entry));
    case 0xa2:
      return !matches(children(filter.value)[0]!, entry);
    case 0xa3: {
      const [name, value] = children(filter.value);
      return attribute(name!.value.toString())?.toLowerCase() === value!.value.toString().toLowerCase();
    }
    case 0x87:
      return attribute(filter.value.toString()) !== undefined;
    // Sous-chaînes (`mail=*`) : tout ce qui a l'attribut correspond, pour que les tests voient une injection réussie.
    case 0xa4:
      return attribute(children(filter.value)[0]!.value.toString()) !== undefined;
    default:
      return false;
  }
}

export interface FakeDirectory {
  port: number;
  entries: DirectoryEntry[];
  /** DN de chaque connexion demandée, dans l'ordre. */
  binds: string[];
  /** Le mot de passe du compte de service est accepté pour ce DN. */
  service: { dn: string; password: string };
  /** Refuse les recherches anonymes (comportement d'Active Directory). */
  anonymousSearch: boolean;
  close: () => Promise<void>;
}

export interface DirectoryTls {
  cert: string;
  key: string;
  /** `ldaps` : TLS dès la connexion ; `starttls` : TCP, puis TLS à la demande. */
  mode: 'ldaps' | 'starttls';
}

export function startDirectory(entries: DirectoryEntry[], secure?: DirectoryTls): Promise<FakeDirectory> {
  const sockets = new Set<net.Socket>();
  const directory = { entries, binds: [] as string[], service: { dn: 'CN=service,DC=test', password: 'service-secret' }, anonymousSearch: false };

  const serve = (socket: net.Socket): void => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let pending = Buffer.alloc(0);
    let bound = false;
    const reply = (id: number, op: Buffer) => socket.write(encode(0x30, integer(id), op));

    const onData = (chunk: Buffer): void => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        const message = readTlv(pending, 0);
        if (!message) return;
        pending = pending.subarray(message.next);
        const [idPart, op] = children(message.value);
        const id = idPart!.value.reduce((sum, byte) => sum * 256 + byte, 0);
        if (op!.tag === 0x60) {
          const [, name, auth] = children(op!.value);
          const dn = name!.value.toString();
          const password = auth!.value.toString();
          directory.binds.push(dn);
          const known = dn === directory.service.dn ? directory.service.password : directory.entries.find((entry) => entry.dn === dn)?.password;
          bound = known !== undefined && password !== '' && known === password;
          reply(id, result(0x61, bound ? 0 : 49));
        } else if (op!.tag === 0x63) {
          if (!bound && !directory.anonymousSearch) {
            reply(id, result(0x65, 1));
            continue;
          }
          const parts = children(op!.value);
          const sizeLimit = parts[3]!.value.reduce((sum, byte) => sum * 256 + byte, 0);
          const found = directory.entries.filter((entry) => matches(parts[6]!, entry));
          const sent = sizeLimit ? found.slice(0, sizeLimit) : found;
          for (const entry of sent) {
            const attributes = Object.entries(entry.attributes).map(([key, value]) => encode(0x30, text(key), encode(0x31, text(value))));
            reply(id, encode(0x64, text(entry.dn), encode(0x30, ...attributes)));
          }
          reply(id, result(0x65, sent.length < found.length ? 4 : 0));
        } else if (op!.tag === 0x77 && secure?.mode === 'starttls') {
          reply(id, result(0x78, 0));
          socket.off('data', onData);
          serve(new tls.TLSSocket(socket, { isServer: true, cert: secure.cert, key: secure.key }));
          return;
        } else if (op!.tag === 0x42) {
          socket.end();
        }
      }
    };
    socket.on('data', onData);
  };
  const server = secure?.mode === 'ldaps' ? tls.createServer({ cert: secure.cert, key: secure.key }, serve) : net.createServer(serve);

  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(
        Object.assign(directory, {
          port: (server.address() as AddressInfo).port,
          close: () =>
            new Promise<void>((done) => {
              for (const socket of sockets) socket.destroy();
              server.close(() => done());
            }),
        }),
      ),
    ),
  );
}
