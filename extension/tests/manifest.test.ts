import { describe, expect, it } from 'vitest';
import manifest from '../public/manifest.json';

describe('extension permissions', () => {
  it('loads the page bridge early without cookie or non-X host access', () => {
    expect(manifest.permissions).not.toContain('cookies');
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.side_panel?.default_path).toBe('dashboard.html');
    expect(manifest.content_scripts[0].run_at).toBe('document_start');
    expect(manifest.web_accessible_resources[0].resources).toContain('x-header-bridge.js');
    expect(manifest.host_permissions).toEqual(['https://x.com/*', 'https://twitter.com/*', 'https://abs.twimg.com/*']);
  });
});
