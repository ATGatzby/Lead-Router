import { Hono } from 'hono'
import Stripe from 'stripe'
import { generateLicenseKey, signLicenseJwt } from '../lib/keys'
import { createLicense, extendLicenseValidity, setGracePeriod, findCustomerByEmail, updateCustomerTier, createCustomer as createCustomerRecord } from '../lib/db'
import { sendLicenseKeyEmail } from '../lib/email'
import { hashPassword } from '../lib/password'

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

const webhook = new Hono<{ Bindings: Env }>()

webhook.post('/', async (c) => {
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  })

  const signature = c.req.header('stripe-signature')
  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400)
  }

  let event: Stripe.Event

  try {
    const rawBody = await c.req.text()
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return c.json({ error: 'Invalid signature' }, 401)
  }

  console.log(`Stripe webhook received: ${event.type} (${event.id})`)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        const email = session.customer_details?.email ?? session.customer_email
        if (!email) {
          console.error('No email found on checkout session:', session.id)
          return c.json({ error: 'No email on session' }, 400)
        }

        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null
        const customerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id ?? null

        // Generate license key and JWT
        const licenseKey = generateLicenseKey()
        const validUntil = new Date()
        validUntil.setFullYear(validUntil.getFullYear() + 1)
        const validUntilStr = validUntil.toISOString()

        const jwt = await signLicenseJwt(
          { key: licenseKey, tier: 'pro', validUntil: validUntilStr },
          c.env.ED25519_PRIVATE_KEY
        )

        // Store in D1
        const licenseId = crypto.randomUUID()
        await createLicense(c.env.DB, {
          id: licenseId,
          key: licenseKey,
          jwt,
          email,
          tier: 'pro',
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          validUntil: validUntilStr,
        })

        console.log(`License created: ${licenseKey} for ${email}`)

        // Link license to customer account (or create one)
        try {
          const existingCustomer = await findCustomerByEmail(c.env.DB, email)
          if (existingCustomer) {
            await updateCustomerTier(c.env.DB, email, 'pro', licenseId)
            console.log(`Customer ${email} upgraded to pro, linked to license ${licenseKey}`)
          } else {
            // Customer bought without signing up — create account with random password
            const tempPw = crypto.randomUUID()
            const { hash, salt } = await hashPassword(tempPw)
            await createCustomerRecord(c.env.DB, {
              id: crypto.randomUUID(),
              email,
              firstName: session.customer_details?.name?.split(' ')[0] ?? 'Customer',
              lastName: session.customer_details?.name?.split(' ').slice(1).join(' ') ?? '',
              passwordHash: hash,
              passwordSalt: salt,
              tier: 'pro',
              emailVerified: 1,
              licenseId: licenseId,
              stripeCustomerId: customerId ?? undefined,
            })
            console.log(`Customer ${email} auto-created on checkout, linked to license ${licenseKey}`)
          }
        } catch (customerErr) {
          // Log but don't fail — license is already created
          console.error('Failed to link customer to license:', customerErr)
        }

        // Send email with license key
        try {
          await sendLicenseKeyEmail(c.env.RESEND_API_KEY, email, licenseKey)
        } catch (emailErr) {
          // Log but don't fail the webhook — license is already created
          console.error('Failed to send license email:', emailErr)
        }

        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId =
          typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription?.id ?? null

        if (!subscriptionId) {
          console.log('No subscription ID on invoice, skipping')
          break
        }

        // Extend validity by 1 year from now
        const newValidUntil = new Date()
        newValidUntil.setFullYear(newValidUntil.getFullYear() + 1)

        await extendLicenseValidity(c.env.DB, subscriptionId, newValidUntil.toISOString())
        console.log(`License extended for subscription: ${subscriptionId}`)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        // Set 30-day grace period
        const graceUntil = new Date()
        graceUntil.setDate(graceUntil.getDate() + 30)

        await setGracePeriod(c.env.DB, subscription.id, graceUntil.toISOString())
        console.log(`Grace period set for subscription: ${subscription.id} until ${graceUntil.toISOString()}`)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err)
    return c.json({ error: 'Webhook handler failed' }, 500)
  }

  return c.json({ received: true })
})

export default webhook
