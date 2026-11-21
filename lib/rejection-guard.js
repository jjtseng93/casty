// A promise nobody awaits can still fail, above all with a CDP timeout from a slow engine, and an
// unhandled rejection ends the whole process: the window closes with no word. Both frontends
// install this instead, so such a failure shows in the status line and casty keeps running.
// `ignore` is true while shutting down or after the page is gone, when closing CDP rejects whatever
// was still in flight and that is expected.
export function guardRejections({report, ignore = () => false, target = process}) {
  const listener = reason => {
    if (ignore()) return;
    const message = String(reason?.message ?? reason).split('\n')[0];
    try { report(`casty: ${message}`); } catch {}
  };
  target.on('unhandledRejection', listener);
  return () => target.removeListener('unhandledRejection', listener);
}
