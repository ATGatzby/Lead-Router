import dns from "dns/promises";
import { URL } from "url";

const BLOCKED_RANGES = [
  /^127\./,           // loopback
  /^10\./,            // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,  // RFC 1918
  /^192\.168\./,      // RFC 1918
  /^169\.254\./,      // link-local
  /^0\./,             // "this" network
  /^::1$/,            // IPv6 loopback
  /^fc00:/i,          // IPv6 ULA
  /^fe80:/i,          // IPv6 link-local
];

const BLOCKED_HOSTS = [
  "metadata.google.internal",
  "metadata.internal",
];

function isPrivateIp(ip: string): boolean {
  return BLOCKED_RANGES.some((re) => re.test(ip));
}

/**
 * Validates a URL is safe to fetch (not targeting internal/private IPs).
 * Resolves the hostname via DNS and checks the resolved IP.
 * @throws Error if the URL targets a private/blocked address
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);

  // Block known metadata hostnames
  if (BLOCKED_HOSTS.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`Blocked host: ${parsed.hostname}`);
  }

  // Block non-HTTP schemes
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }

  // Resolve and check IP
  try {
    const addresses = await dns.resolve4(parsed.hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new Error(`Blocked private IP: ${addr} for host ${parsed.hostname}`);
      }
    }
  } catch (err: any) {
    if (err.message?.startsWith("Blocked")) throw err;
    // DNS resolution failed — could be an IP literal
    if (isPrivateIp(parsed.hostname)) {
      throw new Error(`Blocked private IP: ${parsed.hostname}`);
    }
  }
}
