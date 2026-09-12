import { existsSync, readFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dist), 'utf8'));
const requiredHosts = ['https://x.com/*', 'https://twitter.com/*', 'https://abs.twimg.com/*'];
const files = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap(entry => entry.js ?? []),
  ...(manifest.web_accessible_resources ?? []).flatMap(entry => entry.resources ?? []),
  manifest.side_panel?.default_path
].filter(Boolean);

if (manifest.name !== 'XSweep') throw new Error('Unexpected extension name.');
if ((manifest.permissions ?? []).includes('cookies')) throw new Error('Cookie permission is forbidden.');
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(requiredHosts)) throw new Error('Unexpected host permissions.');
for (const file of files) if (!existsSync(new URL(file, dist))) throw new Error(`Manifest references missing file: ${file}`);

const bundled = files.filter(file => file.endsWith('.js')).map(file => readFileSync(new URL(file, dist), 'utf8')).join('\n');
for (const forbidden of ['raw.githubusercontent.com', 'deletetweets.net', 'auth_token']) {
  if (bundled.includes(forbidden)) throw new Error(`Forbidden runtime reference: ${forbidden}`);
}
console.log(`XSweep package validated: ${files.join(', ')}`);
