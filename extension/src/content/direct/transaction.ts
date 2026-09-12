const EPOCH_MS = 1_682_924_400_000;
const KEYWORD = 'obfiowerehiring';
const EXTRA_BYTE = 3;
const CLIENT_ASSET_ROOT = 'https://abs.twimg.com/responsive-web/client-web/';

export type FetchText = (url: string) => Promise<string>;

function assetBase(html: string): string {
  return html.match(/g\.p="([^"]*responsive-web\/client-web\/)"/)?.[1] ?? CLIENT_ASSET_ROOT;
}

export function findOnDemandAsset(html: string): string | undefined {
  const absolute = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/ondemand\.s\.[\w-]+a\.js/)?.[0];
  if (absolute) return absolute;
  const base = assetBase(html);
  const legacyHash = html.match(/['"]ondemand\.s['"]\s*:\s*['"]([\w-]+)['"]/)?.[1];
  if (legacyHash) return `${base}ondemand.s.${legacyHash}a.js`;
  const chunkId = html.match(/(\d+):["']ondemand\.s["']/)?.[1];
  const chunkHash = chunkId ? html.match(new RegExp(`${chunkId}:["']([a-z0-9]+)["']`, 'i'))?.[1] : undefined;
  return chunkHash ? `${base}ondemand.s.${chunkHash}a.js` : undefined;
}

export function extractIndices(source: string): { row: number; key: number[] } | undefined {
  const indices = [...source.matchAll(/\(\w\[(\d{1,2})\],\s*16\)/g)].map(match => Number(match[1]));
  return indices.length >= 4 && indices.every(Number.isInteger) ? { row: indices[0], key: indices.slice(1) } : undefined;
}

function decodeBase64(value: string): number[] {
  return [...atob(value)].map(character => character.charCodeAt(0));
}

function bezier(control: number[], position: number): number {
  let low = 0;
  let high = 1;
  let current = 0.5;
  const calculate = (first: number, second: number, value: number) => 3 * first * (1 - value) ** 2 * value + 3 * second * (1 - value) * value ** 2 + value ** 3;
  while (low < high) {
    current = (low + high) / 2;
    const x = calculate(control[0], control[2], current);
    if (Math.abs(position - x) < 0.00001) break;
    if (x < position) low = current; else high = current;
  }
  return calculate(control[1], control[3], current);
}

function interpolate(first: number, second: number, amount: number): number {
  return first * (1 - amount) + second * amount;
}

function solve(value: number, minimum: number, maximum: number, floor = false): number {
  const solved = value * (maximum - minimum) / 255 + minimum;
  return floor ? Math.floor(solved) : Number(solved.toFixed(2));
}

function fractionalHex(value: number): string {
  if (!Number.isFinite(value)) return '0';
  let normalized = Math.abs(Math.round(value * 100) / 100);
  const digits: string[] = [];
  let integer = Math.floor(normalized);
  let fraction = normalized - integer;
  do { digits.unshift((integer % 16).toString(16)); integer = Math.floor(integer / 16); } while (integer > 0);
  if (fraction === 0) return digits.join('');
  digits.push('.');
  while (fraction > 0) {
    fraction *= 16;
    const digit = Math.floor(fraction);
    digits.push(digit.toString(16));
    fraction -= digit;
  }
  return digits.join('');
}

function animationKey(document: Document, keyBytes: number[], rowIndex: number, keyIndices: number[]): string {
  const frames = [...document.querySelectorAll<HTMLElement>('[id^="loading-x-anim"]')];
  if (frames.length < 4 || rowIndex >= keyBytes.length || keyIndices.some(index => index >= keyBytes.length)) throw new Error('X transaction animation data is unavailable');
  const frame = frames[keyBytes[5] % 4];
  const path = frame.querySelectorAll('path')[1]?.getAttribute('d');
  if (!path) throw new Error('X transaction animation path is unavailable');
  const rows = path.slice(9).split('C').map(row => row.replace(/[^\d]+/g, ' ').trim().split(/\s+/).map(Number));
  const selected = rows[keyBytes[rowIndex] % 16];
  if (!selected || selected.length < 11) throw new Error('X transaction animation row is invalid');
  const position = keyIndices.reduce((value, index) => value * (keyBytes[index] % 16), 1) / 4096;
  const curve = selected.slice(7).map((value, index) => solve(value, index % 2 ? -1 : 0, 1));
  const eased = bezier(curve, position);
  const from = [...selected.slice(0, 3), 1];
  const to = [...selected.slice(3, 6), 1];
  const color = from.map((value, index) => Math.max(0, interpolate(value, to[index], eased)));
  const angle = interpolate(0, solve(selected[6], 60, 360, true), eased) * Math.PI / 180;
  const rotation = [Math.cos(angle), -Math.sin(angle), Math.sin(angle), Math.cos(angle)];
  return [...color.slice(0, 3).map(value => Math.round(value).toString(16)), ...rotation.map(fractionalHex), '0', '0'].join('').replace(/[.-]/g, '');
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '');
}

export class TransactionIdGenerator {
  private constructor(private readonly keyBytes: number[], private readonly animation: string) {}

  static async create(homeHtml: string, fetchText: FetchText): Promise<TransactionIdGenerator> {
    const document = new DOMParser().parseFromString(homeHtml, 'text/html');
    const key = document.querySelector<HTMLMetaElement>('meta[name="twitter-site-verification"]')?.content;
    if (!key) throw new Error('X verification metadata is unavailable');
    const asset = findOnDemandAsset(homeHtml);
    if (!asset) throw new Error('X transaction asset is unavailable');
    const indices = extractIndices(await fetchText(asset));
    if (!indices) throw new Error('X transaction indices are unavailable');
    const bytes = decodeBase64(key);
    return new TransactionIdGenerator(bytes, animationKey(document, bytes, indices.row, indices.key));
  }

  async generate(method: 'GET' | 'POST', path: string, now = Date.now(), random = Math.random()): Promise<string> {
    const timestamp = Math.floor((now - EPOCH_MS) / 1000);
    if (timestamp < 0) throw new Error('System clock predates X transaction epoch');
    const timestampBytes = [0, 8, 16, 24].map(shift => timestamp >> shift & 255);
    const material = new TextEncoder().encode(`${method}!${path}!${timestamp}${KEYWORD}${this.animation}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
    const mask = Math.floor(random * 256);
    const payload = [...this.keyBytes, ...timestampBytes, ...digest.slice(0, 16), EXTRA_BYTE];
    return encodeBase64(new Uint8Array([mask, ...payload.map(byte => byte ^ mask)]));
  }
}
