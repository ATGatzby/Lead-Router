import { execa, type Options as ExecaOptions } from 'execa'
import { spinner } from '@clack/prompts'

export interface RunOptions {
  label: string
  cwd?: string
  env?: Record<string, string>
}

/**
 * Run a shell command with a clack spinner.
 * Throws on non-zero exit.
 */
export async function run(
  cmd: string,
  args: string[],
  { label, cwd, env }: RunOptions
): Promise<string> {
  const s = spinner()
  s.start(label)
  try {
    const opts: ExecaOptions = {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      reject: true,
    }
    const result = await execa(cmd, args, opts)
    s.stop(`${label} — done`)
    return result.stdout as string
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    s.stop(`${label} — failed`)
    throw new Error(message)
  }
}

/**
 * Run a shell command silently (no spinner), returning stdout.
 * Returns empty string on failure instead of throwing.
 */
export async function runSilent(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {}
): Promise<string> {
  try {
    const result = await execa(cmd, args, { cwd: opts.cwd, reject: false })
    return result.stdout as string
  } catch {
    return ''
  }
}
