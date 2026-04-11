import type { OAuthTokenResponse, OAuthTokenInfo } from './types';

const AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v1/access-tokens';

/**
 * Build the HubSpot OAuth2 authorization URL that the user should be
 * redirected to in the browser.
 */
export function getAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  scopes: string[],
  state?: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
  });
  if (state) {
    params.set('state', state);
  }
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth token exchange failed (${res.status}): ${err}`);
  }

  return (await res.json()) as OAuthTokenResponse;
}

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${err}`);
  }

  return (await res.json()) as OAuthTokenResponse;
}

/**
 * Retrieve metadata about an access token (app ID, hub ID, scopes, etc.).
 */
export async function getTokenInfo(accessToken: string): Promise<OAuthTokenInfo> {
  const res = await fetch(`${TOKEN_INFO_URL}/${accessToken}`, {
    method: 'GET',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get token info (${res.status}): ${err}`);
  }

  return (await res.json()) as OAuthTokenInfo;
}

/**
 * Revoke a refresh token so it can no longer be used.
 */
export async function revokeToken(token: string): Promise<void> {
  const body = new URLSearchParams({ token });

  const res = await fetch(TOKEN_URL, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token revocation failed (${res.status}): ${err}`);
  }
}
