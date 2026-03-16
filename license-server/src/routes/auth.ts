import { Hono } from 'hono'
import { hashPassword, verifyPassword } from '../lib/password'
import { signCustomerJwt } from '../lib/keys'
import { authMiddleware } from '../lib/auth-middleware'
import {
  findCustomerByEmail,
  findCustomerById,
  findCustomerByVerifyToken,
  createCustomer,
  updateCustomerLogin,
  verifyCustomerEmail,
  setEmailVerifyToken,
  findLicenseById,
} from '../lib/db'
import { sendVerificationEmail } from '../lib/email'

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

const auth = new Hono<{ Bindings: Env; Variables: Variables }>()

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// POST /signup
auth.post('/signup', async (c) => {
  try {
    const body = await c.req.json<{
      firstName?: string
      lastName?: string
      email?: string
      password?: string
    }>()

    const { firstName, lastName, email, password } = body

    // Validate required fields
    if (!firstName || !firstName.trim()) {
      return c.json({ error: 'First name is required' }, 400)
    }
    if (!lastName || !lastName.trim()) {
      return c.json({ error: 'Last name is required' }, 400)
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      return c.json({ error: 'Valid email is required' }, 400)
    }
    if (!password || password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400)
    }

    // Check duplicate
    const existing = await findCustomerByEmail(c.env.DB, email)
    if (existing) {
      return c.json({ error: 'An account with this email already exists' }, 409)
    }

    // Hash password
    const { hash, salt } = await hashPassword(password)

    // Generate verification token
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    // Create customer
    await createCustomer(c.env.DB, {
      id: crypto.randomUUID(),
      email,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      passwordHash: hash,
      passwordSalt: salt,
      emailVerifyToken: token,
      emailVerifyExpiry: expiry,
    })

    // Send verification email
    try {
      await sendVerificationEmail(c.env.RESEND_API_KEY, email, firstName.trim(), token)
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr)
    }

    return c.json({ message: 'Verification email sent. Check your inbox.' }, 201)
  } catch (err) {
    console.error('Signup error:', err instanceof Error ? err.message : err, err instanceof Error ? err.stack : '')
    return c.json({ error: 'Signup failed' }, 500)
  }
})

// POST /login
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json<{ email?: string; password?: string }>()

    const { email, password } = body
    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    const customer = await findCustomerByEmail(c.env.DB, email)
    if (!customer) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    const valid = await verifyPassword(password, customer.passwordHash, customer.passwordSalt)
    if (!valid) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    await updateCustomerLogin(c.env.DB, customer.id)

    const token = await signCustomerJwt(
      {
        sub: customer.id,
        email: customer.email,
        tier: customer.tier,
        emailVerified: !!customer.emailVerified,
      },
      c.env.ED25519_PRIVATE_KEY
    )

    return c.json({
      token,
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        tier: customer.tier,
        emailVerified: !!customer.emailVerified,
      },
    })
  } catch (err) {
    console.error('Login error:', err)
    return c.json({ error: 'Login failed' }, 500)
  }
})

// GET /me
auth.get('/me', authMiddleware(), async (c) => {
  try {
    const customerId = c.get('customerId')
    const customer = await findCustomerById(c.env.DB, customerId)
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    let license = null
    if (customer.licenseId) {
      const licenseRecord = await findLicenseById(c.env.DB, customer.licenseId)
      if (licenseRecord) {
        license = {
          key: licenseRecord.key,
          validUntil: licenseRecord.validUntil,
          graceActive: !!licenseRecord.graceUntil,
        }
      }
    }

    return c.json({
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        tier: customer.tier,
        emailVerified: !!customer.emailVerified,
        createdAt: customer.createdAt,
        licenseKey: license?.key ?? null,
        licenseExpiresAt: license?.validUntil ?? null,
        licenseIssuedAt: license ? (license as any).createdAt ?? customer.createdAt : null,
        fingerprint: license ? (license as any).serverFingerprint ?? null : null,
        deployments: license?.key ? 1 : 0,
      },
      license,
    })
  } catch (err) {
    console.error('Get me error:', err)
    return c.json({ error: 'Failed to fetch profile' }, 500)
  }
})

// POST /verify-email
auth.post('/verify-email', async (c) => {
  try {
    const body = await c.req.json<{ token?: string }>()

    if (!body.token) {
      return c.json({ error: 'Token is required' }, 400)
    }

    const customer = await findCustomerByVerifyToken(c.env.DB, body.token)
    if (!customer) {
      return c.json({ error: 'Invalid or expired verification token' }, 400)
    }

    if (!customer.emailVerifyExpiry || new Date(customer.emailVerifyExpiry) <= new Date()) {
      return c.json({ error: 'Verification token has expired' }, 400)
    }

    await verifyCustomerEmail(c.env.DB, customer.id)

    return c.json({ verified: true })
  } catch (err) {
    console.error('Verify email error:', err)
    return c.json({ error: 'Verification failed' }, 500)
  }
})

// POST /resend-verification
auth.post('/resend-verification', authMiddleware(), async (c) => {
  try {
    const customerId = c.get('customerId')
    const customer = await findCustomerById(c.env.DB, customerId)
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    if (customer.emailVerified) {
      return c.json({ error: 'Email is already verified' }, 400)
    }

    // Rate limit: don't allow resend within 60 seconds of last token generation
    if (
      customer.emailVerifyExpiry &&
      new Date(customer.emailVerifyExpiry) > new Date(Date.now() - 60000)
    ) {
      return c.json({ error: 'Please wait before requesting another verification email' }, 429)
    }

    const newToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    await setEmailVerifyToken(c.env.DB, customer.id, newToken, newExpiry)

    await sendVerificationEmail(c.env.RESEND_API_KEY, customer.email, customer.firstName, newToken)

    return c.json({ message: 'Verification email sent' })
  } catch (err) {
    console.error('Resend verification error:', err)
    return c.json({ error: 'Failed to resend verification email' }, 500)
  }
})

export default auth
