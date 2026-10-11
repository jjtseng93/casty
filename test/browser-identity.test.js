import { expect, test } from 'bun:test';
import { setupPage } from '../lib/browser.js';

for (const product of ['Buninu/0.2.1', 'Chrome/154.0.8037.57']) {
  test(`page setup respects the ${product} backend identity`, async () => {
    const commands = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request, server) {
        const path = new URL(request.url).pathname;
        if (path === '/ws') { server.upgrade(request); return; }
        if (path === '/json/version') return Response.json({ Browser: product });
        if (path === '/json/new') return Response.json({ webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/ws` });
        return new Response('not found', { status: 404 });
      },
      websocket: {
        message(socket, data) {
          const command = JSON.parse(data);
          commands.push(command);
          socket.send(JSON.stringify({ id: command.id, result: {} }));
        },
      },
    });
    let client;
    try {
      ({ client } = await setupPage({ port: server.port }, { width: 800, height: 600 }));
      const chromium = product.startsWith('Chrome/');
      expect(commands.some(c => c.method === 'Network.setUserAgentOverride')).toBe(chromium);
      const source = commands.find(c => c.method === 'Page.addScriptToEvaluateOnNewDocument').params.source;
      expect(source.includes('WebGLRenderingContext.prototype')).toBe(chromium);
      expect(source.includes("Object.defineProperty(navigator, 'plugins'")).toBe(chromium);
      expect(source.includes("document.addEventListener('click'")).toBe(true);
      // Parsing is checked for both branches, including nested template strings.
      expect(() => new Function(source)).not.toThrow();
    } finally {
      client?.close();
      server.stop(true);
    }
  });
}
