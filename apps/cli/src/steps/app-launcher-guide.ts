import { note, confirm, isCancel, log } from '@clack/prompts'
import chalk from 'chalk'

/**
 * Guide the customer through completing the 4-step Salesforce App Launcher
 * wizard without leaving the terminal. Prints instructions in a note box,
 * then waits for them to confirm completion before continuing.
 */
export async function guideAppLauncherSetup(appUrl: string): Promise<void> {
  note(
    'Complete the following steps in Salesforce now:\n\n' +
    `  ${chalk.cyan('1.')} Open ${chalk.bold('App Launcher')} (grid icon, top-left in Salesforce)\n` +
    `  ${chalk.cyan('2.')} Search for ${chalk.white('"Lead Router Setup"')} and click it\n` +
    `  ${chalk.cyan('3.')} Click ${chalk.white('"Connect to Lead Router"')}\n` +
    `     → You will be redirected to ${chalk.dim(appUrl)} and back\n` +
    `     → Authorize the OAuth connection when prompted\n\n` +
    `  ${chalk.cyan('4.')} ${chalk.bold('Step 1')} — wait for the ${chalk.green('"Connected"')} checkmark (~5 sec)\n` +
    `  ${chalk.cyan('5.')} ${chalk.bold('Step 2')} — click ${chalk.white('Activate')} to enable Lead triggers\n` +
    `  ${chalk.cyan('6.')} ${chalk.bold('Step 3')} — click ${chalk.white('Sync Fields')} to index your Lead field schema\n` +
    `  ${chalk.cyan('7.')} ${chalk.bold('Step 4')} — click ${chalk.white('Send Test')} to fire a test routing event\n` +
    `     → ${chalk.dim('"Test successful"')} or ${chalk.dim('"No matching rule"')} are both valid\n\n` +
    chalk.dim('Keep this terminal open while you complete the wizard.'),
    'Complete Salesforce setup'
  )

  const done = await confirm({
    message: 'Have you completed the App Launcher wizard?',
    initialValue: false,
  })

  if (isCancel(done)) {
    log.warn(
      'Wizard skipped. Run `lead-routing sfdc deploy` to retry the Salesforce setup.'
    )
    return
  }

  if (!done) {
    log.warn(
      'No problem — complete it at your own pace.\n' +
      '  Open App Launcher → Lead Router Setup → Connect to Lead Router\n' +
      `  Dashboard: ${appUrl}`
    )
  } else {
    log.success('Salesforce setup complete')
  }
}
