import { Hono } from 'hono'
import { cors } from 'hono/cors'
import validate from './routes/validate'
import heartbeat from './routes/heartbeat'
import checkout from './routes/checkout'
import webhook from './routes/webhook'
import auth from './routes/auth'
import account from './routes/account'
import admin from './routes/admin'

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

const app = new Hono<{ Bindings: Env }>()

// CORS for cross-origin requests from marketing site
app.use(
  '*',
  cors({
    origin: ['https://openedgeai.tech', 'https://www.openedgeai.tech', 'http://localhost:5500', 'http://127.0.0.1:5500'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
)

// Health check
app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'lead-routing-license-server' })
})

// Mount routes
app.route('/v1/licenses/validate', validate)
app.route('/v1/licenses/heartbeat', heartbeat)
app.route('/v1/checkout/create', checkout)
app.route('/v1/stripe/webhook', webhook)
app.route('/v1/auth', auth)
app.route('/v1/account', account)
app.route('/v1/admin', admin)

export default app
