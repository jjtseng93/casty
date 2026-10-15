import { test, expect } from 'bun:test';
import { KittyTransport } from '../lib/kitty-transport.js';
function fixture() {
  const writes = [], removed = [], input = [];
  const t = new KittyTransport({ write: s => writes.push(s), createProbe: () => '/tmp/probe.rgb', removeProbe: p => removed.push(p), timeout: 20 });
  return { t, writes, removed, input, feed: text => t.feed(text, s => input.push(s)) };
}
test('file query selects file only for matching OK and preserves adjacent keys', () => {
  const { t, writes, removed, input, feed } = fixture();
  t.probe(); expect(writes[0]).toContain('a=q,t=f,f=24,s=1,v=1');
  feed(`a\x1b_Gi=${t.id+1};OK\x1b\\`); expect(t.mode).toBe('inline');
  feed(`\x1b_Gi=${t.id};O`); expect(t.pending).toBe(true);
  feed('K\x1b\\b'); expect(t.mode).toBe('file');
  expect(input.join('')).toBe('ab'); expect(removed).toEqual(['/tmp/probe.rgb']); t.stop();
});
test('unsupported file or timeout falls back, late reply is swallowed', async () => {
  for (const reply of ['ENOTSUPPORTED:', 'ERROR:missing']) {
    const {t,feed}=fixture(); t.probe(); feed(`\x1b_Gi=${t.id};${reply}\x1b\\`);
    expect(t.mode).toBe('inline'); expect(t.pending).toBe(false); t.stop();
  }
  const { t, feed, input, removed } = fixture(); t.probe();
  await new Promise(r => setTimeout(r, 35));
  feed(`\x1b_Gi=${t.id};OK\x1b\\x`);
  expect(t.mode).toBe('inline'); expect(input.join('')).toBe('x'); expect(removed.length).toBe(1); t.stop();
});
test('manual selection cancels probe and cannot be overridden by late reply', () => {
  const { t,feed }=fixture(); t.probe(); t.select('inline');
  feed(`\x1b_Gi=${t.id};OK\x1b\\`); expect(t.mode).toBe('inline');
  t.select('file'); expect(t.mode).toBe('file'); t.stop();
});
test('Escape key remains input and stop cleans pending probe', async () => {
  const {t,feed,input,removed}=fixture(); feed('\x1b');
  await new Promise(r=>setTimeout(r,60)); expect(input).toEqual(['\x1b']);
  t.probe(); t.stop(); expect(removed).toEqual(['/tmp/probe.rgb']);
});
