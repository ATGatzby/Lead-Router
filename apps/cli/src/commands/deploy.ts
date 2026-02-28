import { intro, outro, log } from '@clack/prompts'
import chalk from 'chalk'
import { findInstallDir, readConfig } from '../utils/config.js'
import { run } from '../utils/exec.js'
import { runMigrations } from '../steps/run-migrations.js'

export async function runDeploy(): Promise<void> {
  console.log()
  intro(chalk.bold.cyan('Lead Routing — Deploy'))

  const dir = findInstallDir()
  if (!dir) {
    log.error(
      'No lead-routing.json found. Run `lead-routing init` first, or run this command from your install directory.'
    )
    process.exit(1)
  }

  const cfg = readConfig(dir)!

  try {
    log.step('Pulling latest images')
    await run('docker', ['compose', 'pull'], { label: 'Pulling images', cwd: dir })

    log.step('Restarting services')
    await run('docker', ['compose', 'up', '-d', '--remove-orphans'], {
      label: 'Restarting containers',
      cwd: dir,
    })

    log.step('Running migrations')
    await runMigrations(dir, '', '') // email/password not needed for deploy

    outro(
      chalk.green('✔  Deployment complete!') +
        `\n\n  ${chalk.cyan(cfg.appUrl)}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Deploy failed: ${message}`)
    process.exit(1)
  }
}
