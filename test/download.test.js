import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadPage, fileNameFor, uniquePath } from '../lib/download.js';

test('fileNameFor uses the last path segment, else the host, and adds .html to pages', () => {
  assert.equal(fileNameFor('https://example.com/docs/report.pdf'), 'report.pdf');
  assert.equal(fileNameFor('https://example.com/'), 'example.com');
  assert.equal(fileNameFor('https://example.com/', 'text/html'), 'example.com.html');
  assert.equal(fileNameFor('https://example.com/a/%E4%B8%AD%E6%96%87?q=1#x', 'text/html'), '中文.html');
  assert.equal(fileNameFor('https://example.com/a%3Ab%2Fc', ''), 'a_b_c');
  assert.equal(fileNameFor('https://example.com/.env'), '_env');
  assert.equal(fileNameFor('not a url'), 'page');
});

test('uniquePath numbers names that exist', () => {
  const taken = new Set([join('/d', 'a.html'), join('/d', 'a (2).html')]);
  assert.equal(uniquePath('/d', 'a.html', (p) => taken.has(p)), join('/d', 'a (3).html'));
  assert.equal(uniquePath('/d', 'b', (p) => taken.has(p)), join('/d', 'b'));
});

test('downloadPage writes the bytes Page.getResourceContent returns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'casty-download-'));
  const calls = [];
  const client = {
    async send(method, params) {
      calls.push([method, params]);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F', url: 'https://x.test/page', mimeType: 'text/html' } } };
      return { content: Buffer.from([0xa4, 0xa4]).toString('base64'), base64Encoded: true };
    },
  };
  const path = await downloadPage(client, dir);
  assert.equal(path, join(dir, 'page.html'));
  assert.deepEqual([...readFileSync(path)], [0xa4, 0xa4]);
  assert.deepEqual(calls[1], ['Page.getResourceContent', { frameId: 'F', url: 'https://x.test/page' }]);
  assert.equal(await downloadPage(client, dir), join(dir, 'page (2).html'));
  await assert.rejects(downloadPage({ send: async () => ({ frameTree: { frame: { id: 'F', url: 'about:blank' } } }) }, dir), /Nothing to download/);
});
