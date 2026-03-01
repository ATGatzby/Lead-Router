import net from 'node:net'
import { NodeSSH } from 'node-ssh'

export interface SshConfig {
  host: string
  port: number
  username: string
  privateKeyPath?: string
  password?: string
  /** Raw remote path as entered by user (may contain ~) */
  remoteDir: string
}

/**
 * Thin wrapper around node-ssh that adds:
 * - exec() that throws on non-zero exit
 * - execSilent() for non-throwing checks
 * - tunnel() for SSH port forwarding (used for Postgres access during migrations)
 * - resolveHome() to expand ~ against the server's $HOME
 */
export class SshConnection {
  private ssh = new NodeSSH()
  private _connected = false

  async connect(config: SshConfig): Promise<void> {
    const opts: Parameters<NodeSSH['connect']>[0] = {
      host: config.host,
      port: config.port,
      username: config.username,
      // Reduce connection timeout to fail fast on bad creds
      readyTimeout: 15000,
    }

    if (config.privateKeyPath) {
      opts.privateKeyPath = config.privateKeyPath
    } else if (config.password) {
      opts.password = config.password
    }

    await this.ssh.connect(opts)
    this._connected = true
  }

  get isConnected(): boolean {
    return this._connected
  }

  /**
   * Run a command remotely. Throws if exit code is non-zero.
   */
  async exec(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
    const result = await this.ssh.execCommand(cmd, cwd ? { cwd } : {})
    if (result.code !== 0) {
      throw new Error(
        `Remote command failed (exit ${result.code}): ${cmd}\n${result.stderr || result.stdout}`
      )
    }
    return { stdout: result.stdout, stderr: result.stderr }
  }

  /**
   * Run a command remotely without throwing — returns code + output.
   */
  async execSilent(
    cmd: string,
    cwd?: string
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const result = await this.ssh.execCommand(cmd, cwd ? { cwd } : {})
    return { stdout: result.stdout, stderr: result.stderr, code: result.code ?? 1 }
  }

  /**
   * Create a remote directory (including parents).
   */
  async mkdir(remotePath: string): Promise<void> {
    await this.exec(`mkdir -p ${remotePath}`)
  }

  /**
   * Upload local files to the remote server via SFTP.
   */
  async upload(files: Array<{ local: string; remote: string }>): Promise<void> {
    await this.ssh.putFiles(files)
  }

  /**
   * Resolve ~ in a remote path by querying $HOME on the server.
   */
  async resolveHome(remotePath: string): Promise<string> {
    if (!remotePath.startsWith('~')) return remotePath
    const { stdout } = await this.exec('echo $HOME')
    return stdout.trim() + remotePath.slice(1)
  }

  /**
   * Open an SSH port-forward tunnel.
   * Creates a local TCP server that pipes connections through to
   * localhost:{remotePort} on the remote machine.
   *
   * Returns the local port and a close() function.
   * Call close() when migrations are done.
   */
  async tunnel(remotePort: number): Promise<{ localPort: number; close: () => void }> {
    const sshClient = this.ssh.connection
    if (!sshClient) throw new Error('SSH not connected — cannot open tunnel')

    const server = net.createServer((socket) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(sshClient as any).forwardOut(
        '127.0.0.1',
        0,
        'localhost',
        remotePort,
        (err: Error | undefined, stream: NodeJS.ReadWriteStream) => {
          if (err) {
            socket.destroy()
            return
          }
          socket.pipe(stream)
          stream.pipe(socket)
          socket.on('close', () => (stream as NodeJS.ReadableStream & { destroy(): void }).destroy())
          stream.on('close', () => socket.destroy())
        }
      )
    })

    return new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as net.AddressInfo
        resolve({
          localPort: port,
          close: () => server.close(),
        })
      })
      server.on('error', reject)
    })
  }

  async disconnect(): Promise<void> {
    if (this._connected) {
      this.ssh.dispose()
      this._connected = false
    }
  }
}
