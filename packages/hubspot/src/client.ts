import { HubSpotError, HubSpotRateLimitError, HubSpotAuthError } from './errors';
import { refreshAccessToken } from './oauth';
import type { RateLimitInfo } from './types';

const BASE_URL = 'https://api.hubapi.com';

// ---------------------------------------------------------------------------
// Sliding-window rate limiter — 100 requests per 10 seconds
// ---------------------------------------------------------------------------

class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 100, windowMs = 10_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /** Wait until a request slot is available, then consume it. */
  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      // Purge timestamps outside the window
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }

      // Wait until the oldest request falls out of the window
      const oldest = this.timestamps[0]!;
      const waitMs = this.windowMs - (now - oldest) + 1;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

/**
 * Called after a successful token refresh with the new access and refresh tokens.
 * Use this to persist the new tokens back to the database.
 */
export type OnTokenRefresh = (accessToken: string, refreshToken: string) => void | Promise<void>;

export interface HubSpotClientOptions {
  accessToken: string;
  /** Supply these three to enable automatic token refresh on 401. */
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Called after successful token refresh — persist new tokens to DB. */
  onTokenRefresh?: OnTokenRefresh;
}

// ---------------------------------------------------------------------------
// HubSpotClient
// ---------------------------------------------------------------------------

/**
 * Low-level HTTP client for the HubSpot API.
 *
 * Handles authentication headers, rate limiting (100 req / 10 s sliding
 * window), and automatic token refresh on 401 when refresh credentials are
 * provided.
 */
export class HubSpotClient {
  private accessToken: string;
  private refreshToken: string | undefined;
  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private onTokenRefresh: OnTokenRefresh | undefined;
  private rateLimiter = new RateLimiter();
  private refreshing: Promise<void> | null = null;
  private _lastRateLimitInfo: RateLimitInfo = {
    remaining: null,
    dailyRemaining: null,
    intervalMs: null,
  };

  constructor(options: HubSpotClientOptions) {
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.onTokenRefresh = options.onTokenRefresh;
  }

  /**
   * Returns the most recent rate limit info from the last HubSpot API response.
   * Values are null if the corresponding header was not present.
   */
  get rateLimitInfo(): RateLimitInfo {
    return { ...this._lastRateLimitInfo };
  }

  /**
   * Suggests a delay in milliseconds based on current rate limit state.
   * Returns 0 if no throttling is needed.
   *
   * - < 5% remaining in the 10-second window  --> 2000ms
   * - < 10% remaining                          --> 500ms
   * - Otherwise                                --> 0ms
   */
  suggestDelay(): number {
    const { remaining, intervalMs } = this._lastRateLimitInfo;
    if (remaining === null) return 0;

    // HubSpot's standard limit is 100 requests per 10s window.
    // The interval header tells us the window size; fall back to 10s.
    const _intervalMs = intervalMs ?? 10_000;
    // Estimate max requests from the known window (100 per 10s is default)
    const maxPerWindow = Math.round((_intervalMs / 10_000) * 100);

    if (maxPerWindow <= 0) return 0;

    const pct = remaining / maxPerWindow;
    if (pct < 0.05) return 2000;
    if (pct < 0.10) return 500;
    return 0;
  }

  // -----------------------------------------------------------------------
  // Public HTTP helpers
  // -----------------------------------------------------------------------

  /** Send a GET request. */
  async get<T = unknown>(path: string, query?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  /** Send a POST request with a JSON body. */
  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** Send a PATCH request with a JSON body. */
  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  /** Send a DELETE request. */
  async delete(path: string): Promise<void> {
    await this.request<void>('DELETE', path);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    await this.rateLimiter.acquire();

    let url = `${BASE_URL}${path}`;
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // --- Parse rate limit headers (available on all responses) ---
    this.parseRateLimitHeaders(res.headers);

    // --- Handle 401 with auto-refresh ---
    if (res.status === 401 && this.canRefresh()) {
      await this.doRefresh();
      // Retry once after refresh
      return this.request<T>(method, path, body, query);
    }

    // --- Handle 429 rate limit — wait and retry once ---
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '10', 10);
      const waitMs = Math.min(retryAfter * 1000, 30_000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      // Retry once after waiting
      const retryRes = await fetch(url, {
        method,
        headers: { ...headers, Authorization: `Bearer ${this.accessToken}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      this.parseRateLimitHeaders(retryRes.headers);
      if (retryRes.status === 429) {
        const retryAfter2 = parseInt(retryRes.headers.get('Retry-After') ?? '10', 10);
        throw new HubSpotRateLimitError(retryAfter2);
      }
      if (!retryRes.ok) {
        const errorBody = await retryRes.json().catch(() => ({}));
        throw new HubSpotError(
          (errorBody as Record<string, string>).message ?? `HTTP ${retryRes.status}`,
          retryRes.status,
          (errorBody as Record<string, string>).category ?? 'UNKNOWN',
          (errorBody as Record<string, string>).correlationId ?? '',
        );
      }
      if (retryRes.status === 204 || retryRes.headers.get('content-length') === '0') {
        return undefined as T;
      }
      return (await retryRes.json()) as T;
    }

    // --- Handle other errors ---
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      const msg =
        (errorBody as Record<string, string>).message ?? `HTTP ${res.status}`;
      const category =
        (errorBody as Record<string, string>).category ?? 'UNKNOWN';
      const correlationId =
        (errorBody as Record<string, string>).correlationId ?? '';

      if (res.status === 401) {
        throw new HubSpotAuthError(msg);
      }

      throw new HubSpotError(msg, res.status, category, correlationId);
    }

    // DELETE typically returns 204 with no body
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  /** Extract rate limit info from response headers and store it. */
  private parseRateLimitHeaders(headers: Headers): void {
    const remaining = headers.get('X-HubSpot-RateLimit-Remaining');
    const dailyRemaining = headers.get('X-HubSpot-RateLimit-Daily-Remaining');
    const intervalMs = headers.get('X-HubSpot-RateLimit-Interval-Milliseconds');

    if (remaining !== null) {
      this._lastRateLimitInfo.remaining = parseInt(remaining, 10);
    }
    if (dailyRemaining !== null) {
      this._lastRateLimitInfo.dailyRemaining = parseInt(dailyRemaining, 10);
    }
    if (intervalMs !== null) {
      this._lastRateLimitInfo.intervalMs = parseInt(intervalMs, 10);
    }
  }

  private canRefresh(): boolean {
    return !!(this.refreshToken && this.clientId && this.clientSecret);
  }

  /** Ensure only one refresh runs at a time. */
  private async doRefresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const tokens = await refreshAccessToken(
            this.clientId!,
            this.clientSecret!,
            this.refreshToken!,
          );
          this.accessToken = tokens.access_token;
          this.refreshToken = tokens.refresh_token;
          // Persist new tokens to DB via callback
          if (this.onTokenRefresh) {
            try {
              await this.onTokenRefresh(tokens.access_token, tokens.refresh_token);
            } catch (err) {
              console.error('[hubspot] Failed to persist refreshed tokens:', err);
            }
          }
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }
}
