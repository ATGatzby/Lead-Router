/**
 * Consumer Key from the Lead Router managed package Connected App.
 * Same across ALL subscriber orgs that install the package.
 * Safe to hardcode — not a secret (PKCE replaces client_secret).
 */
export const MANAGED_PACKAGE_CLIENT_ID = "3MVG9dAEux2v1sLtUdLVrI7EEJM7scjwV2CMazUNIveeSGCj9cajITErcjl5y5HH0dhNfm7wSdtvaBHbUqqGL";

/** Managed package install URL */
export const MANAGED_PACKAGE_INSTALL_URL = "https://login.salesforce.com/packaging/installPackage.apexp?p0=04tgL000000CTnp";

/** Fixed OAuth redirect URL — Cloudflare Worker that forwards to customer's app */
export const OAUTH_REDIRECT_URL = "https://oauth-redirect.artyagi2011.workers.dev";
