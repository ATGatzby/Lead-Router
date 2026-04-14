import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenVerifier } from '../auth/token-verifier.js';

describe('TokenVerifier', () => {
  const APP_URL = 'https://app.example.com';
  let verifier: TokenVerifier;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    verifier = new TokenVerifier(APP_URL);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns AuthInfo with correct fields for a valid token', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tokenId: 'tok_123', scopes: ['read', 'write'] }),
    });

    const result = await verifier.verifyAccessToken('lr_valid_token');

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(`${APP_URL}/api/token-info`, {
      headers: { Authorization: 'Bearer lr_valid_token' },
    });

    expect(result.token).toBe('lr_valid_token');
    expect(result.clientId).toBe('tok_123');
    expect(result.scopes).toEqual(['read', 'write']);
    expect(result.expiresAt).toBeTypeOf('number');
    expect(result.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('defaults clientId to "unknown" when tokenId is missing', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ scopes: ['read'] }),
    });

    const result = await verifier.verifyAccessToken('lr_no_id');

    expect(result.clientId).toBe('unknown');
  });

  it('defaults scopes to ["read"] when scopes are missing', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tokenId: 'tok_456' }),
    });

    const result = await verifier.verifyAccessToken('lr_no_scopes');

    expect(result.scopes).toEqual(['read']);
  });

  it('throws an error for invalid tokens (non-200 response)', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    await expect(
      verifier.verifyAccessToken('lr_bad_token'),
    ).rejects.toThrow('Invalid or expired token');
  });

  it('throws an error when fetch itself rejects', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      verifier.verifyAccessToken('lr_network_fail'),
    ).rejects.toThrow('Network error');
  });

  it('caches valid tokens — second call within 60s does not call fetch again', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tokenId: 'tok_cached', scopes: ['read'] }),
    });

    const first = await verifier.verifyAccessToken('lr_cached');
    const second = await verifier.verifyAccessToken('lr_cached');

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(second).toEqual(first);
  });

  it('cache expires after 60 seconds — fetch is called again', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tokenId: 'tok_v1', scopes: ['read'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tokenId: 'tok_v2', scopes: ['read', 'write'] }),
      });

    const first = await verifier.verifyAccessToken('lr_expiring');
    expect(first.clientId).toBe('tok_v1');

    // Advance time past the 60s TTL
    vi.advanceTimersByTime(60_001);

    const second = await verifier.verifyAccessToken('lr_expiring');
    expect(second.clientId).toBe('tok_v2');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not return stale cache at exactly 60s boundary', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tokenId: 'tok_boundary', scopes: ['read'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tokenId: 'tok_renewed', scopes: ['read'] }),
      });

    await verifier.verifyAccessToken('lr_boundary');

    // At exactly 60_000ms the cache entry has expiresAt = now + 60_000.
    // Date.now() < expiresAt is false at the boundary, so fetch should fire.
    vi.advanceTimersByTime(60_000);

    await verifier.verifyAccessToken('lr_boundary');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('caches different tokens independently', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tokenId: 'tok_a', scopes: ['read'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tokenId: 'tok_b', scopes: ['write'] }),
      });

    const a = await verifier.verifyAccessToken('lr_token_a');
    const b = await verifier.verifyAccessToken('lr_token_b');

    expect(a.clientId).toBe('tok_a');
    expect(b.clientId).toBe('tok_b');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Both should be cached now
    await verifier.verifyAccessToken('lr_token_a');
    await verifier.verifyAccessToken('lr_token_b');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
