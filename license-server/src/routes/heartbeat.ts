import { Hono } from 'hono'
import { findLicenseByKey, updateLicenseHeartbeat, updateLicenseFingerprint } from '../lib/db'

type Env = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  RESEND_API_KEY: string
  ED25519_PRIVATE_KEY: string
  ED25519_PUBLIC_KEY: string
}

const heartbeat = new Hono<{ Bindings: Env }>()

heartbeat.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      key?: string
      fingerprint?: string
      version?: string
      activeUsers?: number
    }>()

    if (!body.key || !body.fingerprint) {
      return c.json({ valid: false, error: 'key and fingerprint are required' }, 400)
    }

    const license = await findLicenseByKey(c.env.DB, body.key)

    if (!license) {
      return c.json({ valid: false, error: 'License not found' }, 404)
    }

    if (!license.isActive) {
      return c.json({ valid: false, error: 'License is inactive' }, 401)
    }

    // Fingerprint check
    if (!license.serverFingerprint) {
      await updateLicenseFingerprint(c.env.DB, body.key, body.fingerprint)
      console.log(`Fingerprint bound via heartbeat: ${body.key}`)
    } else if (license.serverFingerprint !== body.fingerprint) {
      return c.json({ valid: false, error: 'License bound to different server' }, 401)
    }

    const now = new Date()
    const validUntil = new Date(license.validUntil)
    const graceUntil = license.graceUntil ? new Date(license.graceUntil) : null

    // Update heartbeat timestamp
    await updateLicenseHeartbeat(c.env.DB, body.key, now.toISOString())

    console.log(
      `Heartbeat: key=${body.key} version=${body.version ?? 'unknown'} users=${body.activeUsers ?? 0}`
    )

    // Check if subscription has lapsed beyond grace period (30 days)
    if (now > validUntil) {
      if (graceUntil && now <= graceUntil) {
        // Still in grace period
        return c.json({
          valid: true,
          tier: license.tier,
          validUntil: license.validUntil,
          graceActive: true,
        })
      }
      // Past grace — downgrade to free tier
      console.log(`License lapsed beyond grace, downgrading to free: ${body.key}`)
      return c.json({
        valid: true,
        tier: 'free',
        validUntil: license.validUntil,
        graceActive: false,
      })
    }

    return c.json({
      valid: true,
      tier: license.tier,
      validUntil: license.validUntil,
      graceActive: false,
    })
  } catch (err) {
    console.error('Heartbeat error:', err)
    return c.json({ valid: false, error: 'Internal server error' }, 500)
  }
})

export default heartbeat
