/**
 * Adapter factory — creates the right BrowserAdapter based on backend name.
 *
 * Default: 'chrome-cdp' (zero deps, uses installed Chrome).
 * Optional: 'playwright' (requires playwright in node_modules).
 */
import type { BrowserAdapter } from '../types.js';
import { ChromeCdpAdapter } from './chrome-cdp.js';

export type BackendName = 'chrome-cdp' | 'playwright';

const BACKENDS: Record<BackendName, string> = {
  'chrome-cdp': 'Chrome DevTools Protocol (uses your installed Chrome — no extra deps)',
  'playwright': 'Playwright (requires: npm install -D playwright)',
};

/**
 * Create an adapter for the given backend.
 * Throws with a clear message if the backend is not available.
 */
export async function createAdapter(backend: BackendName = 'chrome-cdp'): Promise<BrowserAdapter> {
  switch (backend) {
    case 'chrome-cdp':
      return new ChromeCdpAdapter();

    case 'playwright': {
      // Dynamic import — only loaded if requested
      try {
        const { PlaywrightAdapter } = await import('./playwright.js');
        return new PlaywrightAdapter();
      } catch {
        throw new Error(
          'Playwright adapter requested but playwright is not installed.\n' +
          'Install it: npm install -D playwright\n' +
          'Then retry with --backend playwright'
        );
      }
    }

    default:
      throw new Error(`Unknown backend: ${backend}. Available: ${Object.keys(BACKENDS).join(', ')}`);
  }
}

/**
 * List available backends with their status.
 */
export async function listBackends(): Promise<Array<{ name: BackendName; description: string; available: boolean }>> {
  const results: Array<{ name: BackendName; description: string; available: boolean }> = [];

  // chrome-cdp: check if Chrome exists
  const cdpAdapter = new ChromeCdpAdapter();
  const cdpVersion = await cdpAdapter.version();
  results.push({
    name: 'chrome-cdp',
    description: BACKENDS['chrome-cdp'],
    available: cdpVersion !== 'not found',
  });

  // playwright: check if module is resolvable
  let pwAvailable = false;
  try {
    await import('./playwright.js');
    pwAvailable = true;
  } catch {}
  results.push({
    name: 'playwright',
    description: BACKENDS.playwright,
    available: pwAvailable,
  });

  return results;
}
