// Shared trusted-click synthesis for Chrome DevTools Protocol.

export async function showClickMarker(client, x, y, duration = 800) {
  const expression = `(async () => {
    const old = document.getElementById('__casty_click_marker');
    if (old) old.remove();
    const marker = document.createElement('div');
    marker.id = '__casty_click_marker';
    marker.style.cssText = [
      'position:fixed',
      'left:${x}px',
      'top:${y}px',
      'width:14px',
      'height:14px',
      'margin-left:-7px',
      'margin-top:-7px',
      'box-sizing:border-box',
      'border:2px solid white',
      'border-radius:50%',
      'background:#f00',
      'box-shadow:0 0 0 2px rgba(255,0,0,.45)',
      'pointer-events:none',
      'z-index:2147483647',
    ].join(';');
    document.documentElement.appendChild(marker);
    setTimeout(() => marker.remove(), ${duration});
    await new Promise(resolve => requestAnimationFrame(resolve));
  })()`;
  await client.send('Runtime.evaluate', { expression, awaitPromise: true });
}

export async function dispatchClick(client, x, y, { clickCount = 1, coordinateScale = 1 } = {}) {
  await showClickMarker(client, x, y);
  // Chrome headless-shell applies deviceScaleFactor to rendering but, unlike
  // the CDP specification, consumes Input coordinates in device pixels.
  // Keep the marker in page CSS pixels and scale only the input event.
  const common = {
    x: x * coordinateScale,
    y: y * coordinateScale,
    button: 'left',
    clickCount,
  };
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...common, buttons: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...common, buttons: 0,
  });
}
