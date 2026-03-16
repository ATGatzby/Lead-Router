import * as p from '@clack/prompts'
import chalk from 'chalk'
import { validateLicense, formatTierBadge, type LicenseInfo } from '../utils/license.js'

export interface LicenseResult {
  tier: 'free' | 'pro'
  key?: string
}

export async function validateLicenseStep(): Promise<LicenseResult> {
  // 1. Show intro message about licensing
  p.note(
    `Free tier: 2 routing rules, 1 org, 3 seats, Lead triggers only\n` +
    `Pro tier:  Unlimited everything ($999/year)\n\n` +
    `Purchase a license at ${chalk.cyan('https://openedgeai.tech/pricing')}`,
    'License'
  )

  // 2. Prompt for license key
  const key = await p.text({
    message: 'Enter your license key (or press Enter for free tier)',
    placeholder: 'LR-XXXX-XXXX-XXXX-XXXX',
    validate: () => undefined,  // Allow empty (free tier)
  })

  if (p.isCancel(key)) process.exit(0)

  // 3. If empty → free tier
  const trimmedKey = (key ?? '').toString().trim()
  if (!trimmedKey) {
    p.log.info(`Starting in ${formatTierBadge('free')} mode`)
    return { tier: 'free' }
  }

  // 4. Validate key against license server
  const spinner = p.spinner()
  spinner.start('Validating license key...')

  const result = await validateLicense(trimmedKey)

  if (result.valid) {
    spinner.stop(`License valid! ${formatTierBadge(result.tier)} — expires ${result.validUntil}`)
    return { tier: result.tier, key: trimmedKey }
  }

  // 5. Invalid key — show error, offer retry or continue as free
  spinner.stop(`License validation failed: ${result.error || 'Invalid key'}`)

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'retry', label: 'Enter a different key' },
      { value: 'free', label: 'Continue with free tier' },
      { value: 'exit', label: 'Exit' },
    ],
  })

  if (p.isCancel(action) || action === 'exit') process.exit(0)
  if (action === 'retry') return validateLicenseStep()  // Recurse

  p.log.info(`Starting in ${formatTierBadge('free')} mode`)
  return { tier: 'free' }
}
