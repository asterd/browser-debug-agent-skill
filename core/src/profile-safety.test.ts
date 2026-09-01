import { test, describe } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isBdaProfileDir } from './adapters/chrome-cdp.js';

/**
 * Cleanup runs `pkill -f <profileDir>`, which kills every process whose command
 * line contains that path. Pointed at the user's real Chrome profile it would
 * also close THEIR browser windows, so it must only ever match our own temp
 * profiles.
 */
describe('profile safety', () => {
  test('accepts the temp profiles we create', () => {
    assert.equal(isBdaProfileDir(join(tmpdir(), 'bda-chrome-1234567890')), true);
  });

  test('rejects the real Chrome profile on every platform', () => {
    const realProfiles = [
      '/Users/someone/Library/Application Support/Google/Chrome',
      'C:\\Users\\someone\\AppData\\Local\\Google\\Chrome\\User Data',
      '/home/someone/.config/google-chrome',
    ];
    for (const dir of realProfiles) {
      assert.equal(isBdaProfileDir(dir), false, `would have pkill'd the user's Chrome: ${dir}`);
    }
  });

  test('rejects empty, bare tmpdir, and unrelated paths', () => {
    assert.equal(isBdaProfileDir(''), false);
    assert.equal(isBdaProfileDir(tmpdir()), false);
    assert.equal(isBdaProfileDir(join(tmpdir(), 'bda-chrome-')), false, 'bare prefix matches too much');
    assert.equal(isBdaProfileDir('/'), false);
    assert.equal(isBdaProfileDir(join(tmpdir(), 'something-else')), false);
  });
});
