import * as p from '@clack/prompts'
import chalk from 'chalk'
import { apiLogin, apiResendVerification, saveCredentials } from '../utils/auth.js'
import { formatTierBadge } from '../utils/license.js'

export async function runLogin(): Promise<void> {
  p.intro(chalk.bgBlue.white(' lead-routing login '))

  const email = await p.text({ message: 'Email', placeholder: 'john@acme.com' })
  if (p.isCancel(email)) process.exit(0)

  const password = await p.password({ message: 'Password' })
  if (p.isCancel(password)) process.exit(0)

  const spinner = p.spinner()
  spinner.start('Authenticating...')

  try {
    const { token, customer } = await apiLogin((email as string).trim(), password as string)

    if (!customer.emailVerified) {
      spinner.stop('Email not verified')
      p.log.warn(`Your email (${customer.email}) hasn't been verified yet.`)

      const resend = await p.confirm({ message: 'Resend verification email?' })
      if (resend && !p.isCancel(resend)) {
        try {
          await apiResendVerification(token)
          p.log.success('Verification email sent! Check your inbox.')
        } catch {
          p.log.error('Failed to resend. Try again later.')
        }
      }

      p.note(`Verify your email, then run:\n\n  ${chalk.cyan('lead-routing login')}`, 'Next Steps')
      process.exit(1)
    }

    saveCredentials({ token, customer, storedAt: new Date().toISOString() })
    spinner.stop(`Logged in as ${customer.firstName} ${customer.lastName} — ${formatTierBadge(customer.tier)}`)

    p.note(`Credentials saved to ~/.lead-routing/credentials.json`, 'Saved')
  } catch (err) {
    spinner.stop(err instanceof Error ? err.message : 'Login failed')
    process.exit(1)
  }

  p.outro('Done!')
}
