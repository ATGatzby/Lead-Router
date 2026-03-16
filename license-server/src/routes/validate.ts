import { Hono } from 'hono'
import { findLicenseByKey, updateLicenseFingerprint } from '../lib/db'

type Env = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  RESEND_API_KEY: string
  ED25519_PRIVATE_KEY: string
  ED25519_PUBLIC_KEY: string
}

const validate = new Hono<{ Bindings: Env }>()

validate.post('/', async (c) => {
  try {
    const body = await c.req.json<{ key?: string; fingerprint?: string }>()

    if (!body.key) {
      return c.json({ valid: false, error: 'License key is required' }, 400)
    }

    const license = await findLicenseByKey(c.env.DB, body.key)

    if (!license) {
      console.log(`License not found: ${body.key}`)
      return c.json({ valid: false, error: 'License not found' }, 404)
    }

    if (!license.isActive) {
      console.log(`License inactive: ${body.key}`)
      return c.json({ valid: false, error: 'License is inactive' }, 401)
    }

    const now = new Date()
    const validUntil = new Date(license.validUntil)
    const graceUntil = license.graceUntil ? new Date(license.graceUntil) : null
    let graceActive = false

    if (now > validUntil) {
      if (graceUntil && now <= graceUntil) {
        graceActive = true
        console.log(`License in grace period: ${body.key}`)
      } else {
        console.log(`License expired: ${body.key}`)
        return c.json({ valid: false, error: 'License has expired' }, 401)
      }
    }

    // Fingerprint binding
    if (body.fingerprint) {
      if (!license.serverFingerprint) {
        // Bind fingerprint on first validation
        await updateLicenseFingerprint(c.env.DB, body.key, body.fingerprint)
        console.log(`Fingerprint bound for license: ${body.key}`)
      } else if (license.serverFingerprint !== body.fingerprint) {
        console.log(`Fingerprint mismatch for license: ${body.key}`)
        return c.json({ valid: false, error: 'License bound to different server' }, 401)
      }
    }

    return c.json({
      valid: true,
      tier: license.tier,
      validUntil: license.validUntil,
      graceActive,
    })
  } catch (err) {
    console.error('Validation error:', err)
    return c.json({ valid: false, error: 'Internal server error' }, 500)
  }
})

export default validate
