#!/usr/bin/env node
'use strict'

// Ed25519 public key (base64) — embedded at build time
// This is the PUBLIC key only — safe to distribute
const PUBLIC_KEY_BASE64 = process.env.LICENSE_PUBLIC_KEY || 'N+pGcsgBz8l45heKgwks1vcCMKrakYjE4mxaAPCXrXY='

async function verifyLicense(licenseKey) {
  if (!licenseKey) {
    console.error('[verify-license] No license key provided')
    process.exit(1)
  }

  try {
    // License key IS the JWT in offline mode
    // Parse JWT: header.payload.signature (base64url encoded)
    const parts = licenseKey.split('.')
    if (parts.length !== 3) {
      // Not a JWT — might be LR-XXXX format, can't verify offline
      console.error('[verify-license] Key is not a JWT, cannot verify offline')
      process.exit(1)
    }

    const [headerB64, payloadB64, signatureB64] = parts

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())

    // Check expiry
    if (payload.validUntil) {
      const expiry = new Date(payload.validUntil)
      const now = new Date()
      if (now > expiry) {
        // Check grace period (30 days)
        const grace = new Date(expiry)
        grace.setDate(grace.getDate() + 30)
        if (now > grace) {
          console.error('[verify-license] License expired beyond grace period')
          process.exit(1)
        }
        console.log('[verify-license] License in grace period')
      }
    }

    // Import public key and verify signature
    const publicKeyBytes = Buffer.from(PUBLIC_KEY_BASE64, 'base64')
    const key = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    )

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const signature = Buffer.from(signatureB64, 'base64url')

    const valid = await crypto.subtle.verify('Ed25519', key, signature, data)

    if (valid) {
      console.log(`[verify-license] Signature valid. Tier: ${payload.tier}`)
      // Set tier for parent process
      if (payload.tier) {
        process.env.LICENSE_TIER = payload.tier
      }
      process.exit(0)
    } else {
      console.error('[verify-license] Invalid signature')
      process.exit(1)
    }
  } catch (err) {
    console.error('[verify-license] Verification failed:', err.message)
    process.exit(1)
  }
}

verifyLicense(process.argv[2])
