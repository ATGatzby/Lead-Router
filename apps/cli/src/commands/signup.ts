import * as p from '@clack/prompts'
import chalk from 'chalk'
import { apiSignup } from '../utils/auth.js'

export async function runSignup(): Promise<void> {
  p.intro(chalk.bgBlue.white(' lead-routing signup '))

  const firstName = await p.text({ message: 'First name', placeholder: 'John', validate: (v) => v.trim() ? undefined : 'Required' })
  if (p.isCancel(firstName)) process.exit(0)

  const lastName = await p.text({ message: 'Last name', placeholder: 'Smith', validate: (v) => v.trim() ? undefined : 'Required' })
  if (p.isCancel(lastName)) process.exit(0)

  const email = await p.text({ message: 'Email', placeholder: 'john@acme.com', validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? undefined : 'Invalid email' })
  if (p.isCancel(email)) process.exit(0)

  const password = await p.password({ message: 'Password (min 8 characters)', validate: (v) => v.length >= 8 ? undefined : 'Must be at least 8 characters' })
  if (p.isCancel(password)) process.exit(0)

  const confirm = await p.password({ message: 'Confirm password', validate: (v) => v === password ? undefined : 'Passwords do not match' })
  if (p.isCancel(confirm)) process.exit(0)

  const spinner = p.spinner()
  spinner.start('Creating account...')

  try {
    const message = await apiSignup({
      firstName: (firstName as string).trim(),
      lastName: (lastName as string).trim(),
      email: (email as string).trim(),
      password: password as string,
    })
    spinner.stop('Account created!')

    p.note(
      `Check your email (${(email as string).trim()}) for a verification link.\n\nAfter verifying, run:\n\n  ${chalk.cyan('lead-routing login')}`,
      'Next Steps'
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Signup failed'
    spinner.stop(msg)

    if (msg.includes('already')) {
      p.log.info(`Try ${chalk.cyan('lead-routing login')} instead.`)
    }
    process.exit(1)
  }

  p.outro('Done!')
}
