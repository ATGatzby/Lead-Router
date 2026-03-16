/**
 * Hono middleware for customer JWT authentication.
 */

import { Context, Next } from 'hono'
import { verifyCustomerJwt } from './keys'

export function authMiddleware(options?: { requireVerified?: boolean }) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const token = authHeader.slice(7)
    const payload = await verifyCustomerJwt(token, c.env.ED25519_PUBLIC_KEY)
    if (!payload) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    if (options?.requireVerified && !payload.emailVerified) {
      return c.json({ error: 'email_not_verified' }, 403)
    }
    c.set('customerId', payload.sub)
    c.set('customerEmail', payload.email)
    c.set('emailVerified', payload.emailVerified)
    await next()
  }
}
