/** Base error for all HubSpot API failures. */
export class HubSpotError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public category: string,
    public correlationId: string,
  ) {
    super(message);
    this.name = 'HubSpotError';
  }
}

/** Thrown when the API returns HTTP 429. */
export class HubSpotRateLimitError extends HubSpotError {
  constructor(public retryAfter: number) {
    super('Rate limit exceeded', 429, 'RATE_LIMIT', '');
    this.name = 'HubSpotRateLimitError';
  }
}

/** Thrown when the API returns HTTP 401 and auto-refresh is not possible. */
export class HubSpotAuthError extends HubSpotError {
  constructor(message: string) {
    super(message, 401, 'AUTH', '');
    this.name = 'HubSpotAuthError';
  }
}
