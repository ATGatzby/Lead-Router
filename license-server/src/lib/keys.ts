/**
 * Ed25519 key management and license key generation.
 * Uses Web Crypto API (SubtleCrypto) for Cloudflare Workers compatibility.
 */

// -- License key generation --------------------------------------------------

export function generateLicenseKey(): string {
  const uuid = crypto.randomUUID().replace(/-/g, '').toUpperCase()
  const parts = [
    uuid.slice(0, 4),
    uuid.slice(4, 8),
    uuid.slice(8, 12),
    uuid.slice(12, 16),
  ]
  return `LR-${parts.join('-')}`
}

// -- Base64url helpers -------------------------------------------------------

function base64urlEncode(data: Uint8Array): string {
  const binary = String.fromCharCode(...data)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function textToBase64url(text: string): string {
  return base64urlEncode(new TextEncoder().encode(text))
}

// -- Ed25519 import helpers --------------------------------------------------

async function importPrivateKey(base64Key: string): Promise<CryptoKey> {
  const keyData = base64urlDecode(
    base64Key.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  )
  // Standard base64-encoded raw 32-byte seed or PKCS8
  // Try PKCS8 first, fall back to raw seed
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      keyData,
      { name: 'Ed25519' },
      false,
      ['sign']
    )
  } catch {
    // If raw 32-byte seed, wrap in PKCS8 DER envelope
    const pkcs8Prefix = new Uint8Array([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
      0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ])
    const pkcs8 = new Uint8Array(pkcs8Prefix.length + keyData.length)
    pkcs8.set(pkcs8Prefix)
    pkcs8.set(keyData, pkcs8Prefix.length)
    return await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'Ed25519' },
      false,
      ['sign']
    )
  }
}

async function importPublicKey(base64Key: string): Promise<CryptoKey> {
  const keyData = base64urlDecode(
    base64Key.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  )
  try {
    return await crypto.subtle.importKey(
      'spki',
      keyData,
      { name: 'Ed25519' },
      false,
      ['verify']
    )
  } catch {
    // If raw 32-byte public key, wrap in SPKI DER envelope
    const spkiPrefix = new Uint8Array([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
      0x70, 0x03, 0x21, 0x00,
    ])
    const spki = new Uint8Array(spkiPrefix.length + keyData.length)
    spki.set(spkiPrefix)
    spki.set(keyData, spkiPrefix.length)
    return await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'Ed25519' },
      false,
      ['verify']
    )
  }
}

// -- JWT sign / verify -------------------------------------------------------

export interface LicenseJwtPayload {
  key: string
  tier: string
  validUntil: string
  iat?: number
  iss?: string
}

export async function signLicenseJwt(
  payload: { key: string; tier: string; validUntil: string },
  privateKeyBase64: string
): Promise<string> {
  const header = { alg: 'EdDSA', typ: 'JWT' }
  const fullPayload: LicenseJwtPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    iss: 'lead-routing-license-server',
  }

  const encodedHeader = textToBase64url(JSON.stringify(header))
  const encodedPayload = textToBase64url(JSON.stringify(fullPayload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const privateKey = await importPrivateKey(privateKeyBase64)
  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    new TextEncoder().encode(signingInput)
  )

  const encodedSignature = base64urlEncode(new Uint8Array(signature))
  return `${signingInput}.${encodedSignature}`
}

export async function verifyLicenseJwt(
  jwt: string,
  publicKeyBase64: string
): Promise<LicenseJwtPayload | null> {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null

    const [encodedHeader, encodedPayload, encodedSignature] = parts
    const signingInput = `${encodedHeader}.${encodedPayload}`
    const signature = base64urlDecode(encodedSignature)

    const publicKey = await importPublicKey(publicKeyBase64)
    const valid = await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      signature,
      new TextEncoder().encode(signingInput)
    )

    if (!valid) return null

    const payloadJson = new TextDecoder().decode(base64urlDecode(encodedPayload))
    return JSON.parse(payloadJson) as LicenseJwtPayload
  } catch (err) {
    console.error('JWT verification failed:', err)
    return null
  }
}

// -- Customer JWT sign / verify -----------------------------------------------

export interface CustomerJwtPayload {
  sub: string
  email: string
  tier: string
  emailVerified: boolean
  iat: number
  exp: number
  iss: string
}

export async function signCustomerJwt(
  payload: { sub: string; email: string; tier: string; emailVerified: boolean },
  privateKeyBase64: string
): Promise<string> {
  const header = { alg: 'EdDSA', typ: 'JWT' }
  const fullPayload: CustomerJwtPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    iss: 'lead-routing-auth',
  }

  const encodedHeader = textToBase64url(JSON.stringify(header))
  const encodedPayload = textToBase64url(JSON.stringify(fullPayload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const privateKey = await importPrivateKey(privateKeyBase64)
  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    new TextEncoder().encode(signingInput)
  )

  const encodedSignature = base64urlEncode(new Uint8Array(signature))
  return `${signingInput}.${encodedSignature}`
}

export async function verifyCustomerJwt(
  jwt: string,
  publicKeyBase64: string
): Promise<CustomerJwtPayload | null> {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null

    const [encodedHeader, encodedPayload, encodedSignature] = parts
    const signingInput = `${encodedHeader}.${encodedPayload}`
    const signature = base64urlDecode(encodedSignature)

    const publicKey = await importPublicKey(publicKeyBase64)
    const valid = await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      signature,
      new TextEncoder().encode(signingInput)
    )

    if (!valid) return null

    const payloadJson = new TextDecoder().decode(base64urlDecode(encodedPayload))
    const payload = JSON.parse(payloadJson) as CustomerJwtPayload

    // Validate issuer and expiry
    if (payload.iss !== 'lead-routing-auth') return null
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null

    return payload
  } catch (err) {
    console.error('Customer JWT verification failed:', err)
    return null
  }
}
