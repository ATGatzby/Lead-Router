import { Command } from 'commander'
import { runInit } from './commands/init.js'
import { runDeploy } from './commands/deploy.js'
import { runDoctor } from './commands/doctor.js'
import { runLogs } from './commands/logs.js'
import { runStatus } from './commands/status.js'
import { runConfigSfdc, runConfigShow } from './commands/config.js'
import { runSfdcDeploy } from './commands/sfdc.js'

const program = new Command()

program
  .name('lead-routing')
  .description('Self-hosted Lead Routing — scaffold, deploy, and manage your installation')
  .version('0.1.0')

program
  .command('init')
  .description('Interactive setup wizard — configure and deploy the full Lead Routing stack')
  .option('--dry-run', 'Run the wizard and generate config files without starting Docker services')
  .action((opts: { dryRun?: boolean }) => runInit({ dryRun: opts.dryRun }))

program
  .command('deploy')
  .description('Pull latest images, restart services, and run any pending migrations')
  .action(runDeploy)

program
  .command('doctor')
  .description('Check the health of all services in your installation')
  .action(runDoctor)

program
  .command('logs [service]')
  .description('Stream logs from a service (web, engine, postgres, redis). Defaults to engine.')
  .action((service?: string) => runLogs(service))

program
  .command('status')
  .description('Show the running state of all Docker containers')
  .action(runStatus)

const config = program
  .command('config')
  .description('Update configuration values in a live installation')

config
  .command('show')
  .description('Print key config values for this installation (admin secret, app URL, SFDC client ID)')
  .action(runConfigShow)

config
  .command('sfdc')
  .description('Update Salesforce Connected App credentials (Consumer Key + Secret)')
  .action(runConfigSfdc)

const sfdc = program
  .command('sfdc')
  .description('Manage the Salesforce package for this installation')

sfdc
  .command('deploy')
  .description('Deploy (or redeploy) the Lead Router Salesforce package to your Salesforce org')
  .action(runSfdcDeploy)

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
