import { Hono } from 'hono'
import {
  getAllCustomers,
  getCustomerCount,
  getProCustomerCount,
  getVerifiedCount,
  getRecentSignups,
} from '../lib/db'

type Env = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRICE_ID: string
  RESEND_API_KEY: string
  ED25519_PRIVATE_KEY: string
  ED25519_PUBLIC_KEY: string
  ADMIN_SECRET: string
}

const admin = new Hono<{ Bindings: Env }>()

// Admin auth middleware — simple bearer token check against ADMIN_SECRET
admin.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (authHeader !== `Bearer ${c.env.ADMIN_SECRET}`) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
})

// GET /customers
admin.get('/customers', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') ?? '20', 10)
    const offset = parseInt(c.req.query('offset') ?? '0', 10)
    const search = c.req.query('search') || undefined
    const tier = c.req.query('tier') || undefined

    const [customers, total] = await Promise.all([
      getAllCustomers(c.env.DB, limit, offset, search, tier),
      getCustomerCount(c.env.DB),
    ])

    return c.json({ customers, total })
  } catch (err) {
    console.error('Admin customers error:', err)
    return c.json({ error: 'Failed to fetch customers' }, 500)
  }
})

// GET /stats
admin.get('/stats', async (c) => {
  try {
    const [totalSignups, proCustomers, verifiedCount, recentSignups7d, recentSignups30d] =
      await Promise.all([
        getCustomerCount(c.env.DB),
        getProCustomerCount(c.env.DB),
        getVerifiedCount(c.env.DB),
        getRecentSignups(c.env.DB, 7),
        getRecentSignups(c.env.DB, 30),
      ])

    const conversionRate = totalSignups > 0 ? (proCustomers / totalSignups) * 100 : 0
    const mrr = (proCustomers * 999) / 12
    const verifiedRate = totalSignups > 0 ? (verifiedCount / totalSignups) * 100 : 0

    return c.json({
      totalSignups,
      proCustomers,
      conversionRate: Math.round(conversionRate * 100) / 100,
      mrr: Math.round(mrr * 100) / 100,
      verifiedRate: Math.round(verifiedRate * 100) / 100,
      recentSignups7d,
      recentSignups30d,
    })
  } catch (err) {
    console.error('Admin stats error:', err)
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
})

// GET /activity
admin.get('/activity', async (c) => {
  try {
    const results = await c.env.DB
      .prepare(
        `SELECT id, email, firstName, lastName, tier, createdAt, lastLoginAt, updatedAt
         FROM customers
         ORDER BY COALESCE(lastLoginAt, updatedAt, createdAt) DESC
         LIMIT 20`
      )
      .all<{
        id: string
        email: string
        firstName: string
        lastName: string
        tier: string
        createdAt: string
        lastLoginAt: string | null
        updatedAt: string
      }>()

    const events = results.results.map((customer) => {
      // Determine most recent activity type
      let type: 'signup' | 'login' | 'upgrade' = 'signup'
      let timestamp = customer.createdAt

      if (customer.lastLoginAt && customer.lastLoginAt > timestamp) {
        type = 'login'
        timestamp = customer.lastLoginAt
      }
      if (customer.tier === 'pro' && customer.updatedAt > timestamp) {
        type = 'upgrade'
        timestamp = customer.updatedAt
      }

      return {
        type,
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          tier: customer.tier,
        },
        timestamp,
      }
    })

    return c.json({ events })
  } catch (err) {
    console.error('Admin activity error:', err)
    return c.json({ error: 'Failed to fetch activity' }, 500)
  }
})

// GET /revenue
admin.get('/revenue', async (c) => {
  try {
    const proCount = await getProCustomerCount(c.env.DB)

    // Count licenses in grace period
    const graceResult = await c.env.DB
      .prepare(
        "SELECT COUNT(*) as count FROM licenses WHERE graceUntil IS NOT NULL AND graceUntil > datetime('now')"
      )
      .first<{ count: number }>()
    const gracePeriodCount = graceResult?.count ?? 0

    // Count churned in last 90 days (grace period expired)
    const churnResult = await c.env.DB
      .prepare(
        "SELECT COUNT(*) as count FROM licenses WHERE graceUntil IS NOT NULL AND graceUntil <= datetime('now') AND graceUntil >= datetime('now', '-90 days')"
      )
      .first<{ count: number }>()
    const churn90d = churnResult?.count ?? 0

    const arr = proCount * 999
    const mrr = Math.round((arr / 12) * 100) / 100

    return c.json({
      arr,
      mrr,
      activeSubscriptions: proCount,
      churn90d,
      gracePeriodCount,
    })
  } catch (err) {
    console.error('Admin revenue error:', err)
    return c.json({ error: 'Failed to fetch revenue data' }, 500)
  }
})

export default admin
