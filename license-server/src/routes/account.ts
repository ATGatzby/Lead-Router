import { Hono } from 'hono'
import Stripe from 'stripe'
import { authMiddleware } from '../lib/auth-middleware'
import { findCustomerById } from '../lib/db'

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

type Variables = {
  customerId: string
  customerEmail: string
  emailVerified: boolean
}

const account = new Hono<{ Bindings: Env; Variables: Variables }>()

// All routes require verified email
account.use('*', authMiddleware({ requireVerified: true }))

// POST /upgrade
account.post('/upgrade', async (c) => {
  try {
    const customerId = c.get('customerId')
    const customer = await findCustomerById(c.env.DB, customerId)
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: c.env.STRIPE_PRICE_ID, quantity: 1 }],
      customer_email: customer.email,
      success_url: 'https://openedgeai.tech/dashboard.html?upgraded=true',
      cancel_url: 'https://openedgeai.tech/dashboard.html',
    })

    return c.json({ url: session.url })
  } catch (err) {
    console.error('Upgrade error:', err)
    return c.json({ error: 'Failed to create checkout session' }, 500)
  }
})

// GET /billing-portal
account.get('/billing-portal', async (c) => {
  try {
    const customerId = c.get('customerId')
    const customer = await findCustomerById(c.env.DB, customerId)
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    if (!customer.stripeCustomerId) {
      return c.json({ error: 'No billing information found' }, 400)
    }

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: 'https://openedgeai.tech/dashboard.html',
    })

    return c.json({ url: session.url })
  } catch (err) {
    console.error('Billing portal error:', err)
    return c.json({ error: 'Failed to create billing portal session' }, 500)
  }
})

export default account
