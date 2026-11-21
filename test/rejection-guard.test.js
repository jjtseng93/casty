import {test, expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {guardRejections} from '../lib/rejection-guard.js';
import {startInputHandling} from '../lib/input.js';
import {UrlBar, PromptHistory} from '../lib/urlbar.js';

const guard = new URL('../lib/rejection-guard.js', import.meta.url).href;
async function run(script) {
  const child = Bun.spawn([process.execPath, '-e', script], {stdout: 'pipe', stderr: 'pipe'});
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return {out, code};
}

test('an unhandled rejection ends the process unless it is guarded', async () => {
  // Once the event loop is running, as casty's is: top-level await would keep the module alive.
  const late = (install) => `
    ${install}
    setInterval(() => {}, 1000);
    setTimeout(() => { Promise.reject(Object.assign(Error('CDP timeout: Input.dispatchMouseEvent\\n  at stack'),{code:'CDP_TIMEOUT'})); }, 50);
    setTimeout(() => { console.log('alive', JSON.stringify(globalThis.shown ?? [])); process.exit(0); }, 400);`;
  const bare = await run(late(''));
  expect(bare.out).not.toContain('alive');
  expect(bare.code).not.toBe(0);
  const guarded = await run(late(`import {guardRejections} from '${guard}'; globalThis.shown = []; guardRejections({report: m => globalThis.shown.push(m)});`));
  expect(guarded.code).toBe(0);
  expect(guarded.out).toContain('alive ["casty: CDP timeout: Input.dispatchMouseEvent"]');
});

test('the guard stays quiet while shutting down and can be removed', () => {
  const target = new EventEmitter(), shown = [];
  let quiet = false;
  const stop = guardRejections({report: m => shown.push(m), ignore: () => quiet, target});
  target.emit('unhandledRejection', Error('first'));
  quiet = true;
  target.emit('unhandledRejection', Error('during shutdown'));
  quiet = false;
  target.emit('unhandledRejection', 'plain text reason');
  expect(shown).toEqual(['casty: first', 'casty: plain text reason']);
  expect(() => { throw Error('a reporter that fails must not escape'); }).toThrow();
  const bad = new EventEmitter();
  guardRejections({report() { throw Error('status line gone'); }, target: bad});
  expect(() => bad.emit('unhandledRejection', Error('x'))).not.toThrow();
  stop();
  expect(target.listenerCount('unhandledRejection')).toBe(0);
});

// While a page dialog is open the native input skips the queue; a timeout there used to escape.
function dialogFixture() {
  const client = new EventEmitter();
  client.send = async method => {
    if (method === 'Page.getNavigationHistory') return {currentIndex: 0, entries: [{id: 1, url: 'https://example.com'}]};
    if (method.startsWith('Input.')) throw Object.assign(Error(`CDP timeout: ${method}`), {code: 'CDP_TIMEOUT'});
    return {};
  };
  const bar = new UrlBar({history: new PromptHistory(null)});
  bar.native = true; bar.render = () => {};
  const controller = startInputHandling(client, 1, 1, 1, {}, () => {}, null, {},
    {native: {urlBar: bar, quit() {}, clipboardWrite() {}, clipboardRead: async () => ''}});
  client.emit('Page.javascriptDialogOpening');
  return {client, controller};
}

test('native input to an open page dialog survives a CDP timeout', async () => {
  const {controller} = dialogFixture();
  const errors = [], original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await controller.dispatchNativeText('a');          // Input.insertText
    await controller.dispatchNative('x', null);        // handled as input for the dialog
    await controller.dispatchNativeText('b', {key: 'b', code: 'KeyB', keyCode: 66, modifiers: 0});
  } finally { console.error = original; controller.dispose(); }
  expect(errors.some(e => e.includes('CDP timeout: Input.insertText'))).toBe(true);
});
