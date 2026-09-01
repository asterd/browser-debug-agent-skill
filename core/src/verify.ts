import type { BrowserAdapter, VerifyAssertion, VerifyManifest, VerifyResult } from './types.js';

/**
 * Execute a verify manifest against a browser adapter.
 * Returns a result for each assertion — no LLM judgment involved.
 */
export async function verify(adapter: BrowserAdapter, manifest: VerifyManifest): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];

  const viewport = manifest.viewport ?? { width: 1280, height: 720 };
  await adapter.open(manifest.url, { viewport });

  // --window-size does not set the layout viewport in headless mode, so responsive
  // assertions would silently run at the default size. Apply device metrics too.
  await adapter.resize(viewport.width, viewport.height);

  for (const assertion of manifest.assertions) {
    const result = await runAssertion(adapter, assertion);
    results.push(result);
  }

  return results;
}

async function runAssertion(adapter: BrowserAdapter, assertion: VerifyAssertion): Promise<VerifyResult> {
  try {
    switch (assertion.type) {
      case 'console_errors': {
        const entries = await adapter.console();
        const errors = entries.filter(e => e.level === 'error');
        if (assertion.expect === 'none' || assertion.expect === 0) {
          return errors.length === 0
            ? { assertion, status: 'pass', actual: 0 }
            : { assertion, status: 'fail', actual: errors.map(e => e.text) };
        }
        return { assertion, status: 'pass', actual: errors.length };
      }

      case 'network_status': {
        const entries = await adapter.network();
        // expect: { url: pattern, status: 200 } or { failed: 'none' }
        const expect = assertion.expect as Record<string, unknown>;
        if (expect.failed === 'none') {
          // Ignore favicon and other browser-internal requests
          const ignored = /favicon\.ico|\.well-known|^chrome/;
          const failed = entries.filter(e => e.status >= 400 && !ignored.test(e.url));
          return failed.length === 0
            ? { assertion, status: 'pass', actual: [] }
            : { assertion, status: 'fail', actual: failed.map(e => `${e.method} ${e.url} ${e.status}`) };
        }
        if (expect.url && expect.status) {
          const pattern = new RegExp(expect.url as string);
          const matching = entries.filter(e => pattern.test(e.url));
          const ok = matching.length > 0 && matching.every(e => e.status === expect.status);
          return ok
            ? { assertion, status: 'pass', actual: matching.length }
            : { assertion, status: 'fail', actual: matching.map(e => `${e.url}: ${e.status}`) };
        }
        return { assertion, status: 'skip', error: 'Unsupported network_status expect format' };
      }

      case 'visible': {
        const snapshot = await adapter.snapshot();
        const target = assertion.expect as string;
        const found = snapshot.tree.includes(target);
        return found
          ? { assertion, status: 'pass', actual: true }
          : { assertion, status: 'fail', actual: false, error: `"${target}" not found in snapshot` };
      }

      case 'js': {
        const expr = assertion.expect as string;
        const result = await adapter.evaluate(expr);
        const truthy = Boolean(result);
        return truthy
          ? { assertion, status: 'pass', actual: result }
          : { assertion, status: 'fail', actual: result, error: `Expression evaluated to falsy: ${expr}` };
      }

      case 'snapshot_contains': {
        const snapshot = await adapter.snapshot();
        const target = assertion.expect as string;
        const found = snapshot.tree.includes(target);
        return found
          ? { assertion, status: 'pass', actual: true }
          : { assertion, status: 'fail', actual: false, error: `Snapshot does not contain: ${target}` };
      }

      default:
        return { assertion, status: 'skip', error: `Unknown assertion type: ${assertion.type}` };
    }
  } catch (err) {
    return { assertion, status: 'fail', error: String(err) };
  }
}
