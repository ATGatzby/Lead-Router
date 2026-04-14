import { describe, it, expect } from 'vitest';

describe('HTTP Server', () => {
  it('should export startHttpServer function', async () => {
    const mod = await import('../http-server.js');
    expect(typeof mod.startHttpServer).toBe('function');
  });

  it('should export HttpServerOptions type (startHttpServer accepts correct arity)', async () => {
    const mod = await import('../http-server.js');
    // startHttpServer takes 3 arguments: server, config, options
    expect(mod.startHttpServer.length).toBe(3);
  });
});
