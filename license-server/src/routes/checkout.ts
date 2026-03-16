import { Hono } from 'hono'
import Stripe from 'stripe'

type Env = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRICE_ID: string
  RESEND_API_KEY: string
  ED25519_PRIVATE_KEY: string
  ED25519_PUBLIC_KEY: string
}

const checkout = new Hono<{ Bindings: Env }>()

checkout.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      email?: string
      successUrl?: string
      cancelUrl?: string
    }>()

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: c.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url:
        body.successUrl || 'https://openedgeai.tech/dashboard.html?upgraded=true',
      cancel_url: body.cancelUrl || 'https://openedgeai.tech/dashboard.html',
    }

    if (body.email) {
      sessionParams.customer_email = body.email
    }

    console.log(`Creating checkout session for email: ${body.email ?? 'not provided'}`)

    const session = await stripe.checkout.sessions.create(sessionParams)

    return c.json({ url: session.url })
  } catch (err) {
    console.error('Checkout error:', err)
    return c.json({ error: 'Failed to create checkout session' }, 500)
  }
})

export default checkout
