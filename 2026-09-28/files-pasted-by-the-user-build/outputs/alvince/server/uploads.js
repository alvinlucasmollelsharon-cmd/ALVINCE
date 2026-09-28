import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const uploadDir = resolve(process.env.UPLOAD_DIR || './data/uploads');
const MAX_VIDEO = 50 * 1024 * 1024;
const MAX_IMAGE = 12 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['image/jpeg', { ext: '.jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ['image/png', { ext: '.png', test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) }],
  ['image/webp', { ext: '.webp', test: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }],
  ['image/gif', { ext: '.gif', test: (b) => b.length >= 3 && b.toString('ascii', 0, 3) === 'GIF' }],
  ['image/avif', { ext: '.avif', test: (b) => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(b.toString('ascii', 8, 12)) }],
]);
const VIDEO_TYPES = new Map([
  ['video/mp4', { ext: '.mp4', test: (b) => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' }],
  ['video/webm', { ext: '.webm', test: (b) => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) }],
  ['video/quicktime', { ext: '.mov', test: (b) => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' }],
]);
const EXTENSION_MIME = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.avif', 'image/avif'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.mov', 'video/quicktime'],
]);

export async function saveUpload(file, kind) {
  if (!file || !file.data?.length) throw new HttpInputError('Choose a file to upload.');
  const map = kind === 'picture' ? IMAGE_TYPES : VIDEO_TYPES;
  const limit = kind === 'picture' ? MAX_IMAGE : MAX_VIDEO;
  if (file.data.length > limit) throw new HttpInputError(`${kind === 'picture' ? 'Pictures' : 'Videos'} must be under ${kind === 'picture' ? '12 MB' : '50 MB'}.`);
  const extension = String(file.name || '').match(/(\.[a-z0-9]+)$/i)?.[1].toLowerCase();
  const mime = map.has(file.mime) ? file.mime : EXTENSION_MIME.get(extension);
  const type = map.get(mime);
  if (!type) throw new HttpInputError(kind === 'picture' ? 'Choose a JPG, PNG, WebP, GIF or AVIF picture.' : 'Choose an MP4, WebM or MOV video.');
  if (!type.test(file.data.subarray(0, 32))) throw new HttpInputError('This file does not match its image or video type.');
  await mkdir(uploadDir, { recursive: true });
  const name = `${randomUUID()}${type.ext}`;
  await writeFile(resolve(uploadDir, name), file.data, { flag: 'wx', mode: 0o640 });
  return { name, mime, size: file.data.length };
}

export async function deleteUpload(name) {
  if (!name || name.includes('/') || name.includes('\\') || !/^[0-9a-f-]{36}\.(?:jpg|png|webp|gif|avif|mp4|webm|mov)$/.test(name)) return;
  try { await unlink(resolve(uploadDir, name)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

export class HttpInputError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

export async function parseMultipart(req, maxBytes = MAX_VIDEO + 1024 * 1024) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new HttpInputError('Expected a multipart form.');
  const boundary = Buffer.from(`--${(boundaryMatch[1] || boundaryMatch[2]).trim()}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new HttpInputError('This upload is too large.');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const fields = Object.create(null);
  const files = Object.create(null);
  let cursor = body.indexOf(boundary);
  if (cursor < 0) throw new HttpInputError('Invalid upload form.');
  cursor += boundary.length;
  while (cursor < body.length) {
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) cursor += 2;
    const headEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headEnd < 0) throw new HttpInputError('Invalid upload form.');
    const header = body.toString('utf8', cursor, headEnd);
    const disposition = header.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    const mime = header.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || 'application/octet-stream';
    const dataStart = headEnd + 4;
    const next = body.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), dataStart);
    if (next < 0 || !disposition) throw new HttpInputError('Invalid upload form.');
    const data = body.subarray(dataStart, next);
    const [, field, filename] = disposition;
    if (filename !== undefined) {
      if (files[field]) throw new HttpInputError('Upload one file at a time.');
      files[field] = { name: filename, mime, data };
    } else {
      if (data.length > 10000) throw new HttpInputError('A form field is too long.');
      fields[field] = data.toString('utf8');
    }
    cursor = next + 2 + boundary.length;
  }
  return { fields, files };
}
