/**
 * Lightweight Salesforce REST API client.
 * Replaces the `sf` CLI dependency — uses built-in fetch() (Node 20+).
 */

const API_VERSION = 'v59.0'

export class SalesforceApi {
  private baseUrl: string

  constructor(
    private instanceUrl: string,
    private accessToken: string
  ) {
    // Ensure no trailing slash
    this.baseUrl = `${instanceUrl.replace(/\/+$/, '')}/services/data/${API_VERSION}`
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      ...extra,
    }
  }

  /** Execute a SOQL query and return records */
  async query<T extends Record<string, unknown>>(soql: string): Promise<T[]> {
    const url = `${this.baseUrl}/query?q=${encodeURIComponent(soql)}`
    const res = await fetch(url, { headers: this.headers() })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`SOQL query failed (${res.status}): ${body}`)
    }
    const data = (await res.json()) as { records: T[] }
    return data.records
  }

  /** Create an sObject record, returns the new record ID */
  async create(
    sobject: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const url = `${this.baseUrl}/sobjects/${sobject}`
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.text()
      // Duplicate detection for PermissionSetAssignment
      if (res.status === 400 && body.includes('Duplicate')) {
        throw new DuplicateError(body)
      }
      throw new Error(`Create ${sobject} failed (${res.status}): ${body}`)
    }
    const result = (await res.json()) as { id: string }
    return result.id
  }

  /** Update an sObject record */
  async update(
    sobject: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const url = `${this.baseUrl}/sobjects/${sobject}/${id}`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Update ${sobject}/${id} failed (${res.status}): ${body}`)
    }
  }

  /** Get current user info (for permission set assignment) */
  async getCurrentUserId(): Promise<string> {
    const url = `${this.instanceUrl.replace(/\/+$/, '')}/services/oauth2/userinfo`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Get current user failed (${res.status}): ${body}`)
    }
    const data = (await res.json()) as { user_id: string }
    return data.user_id
  }

  /**
   * Deploy metadata using the Source Deploy API (same API that `sf project deploy start` uses).
   * Accepts a ZIP buffer containing the source-format package.
   * Returns the deploy request ID for polling.
   */
  async deployMetadata(zipBuffer: Buffer): Promise<string> {
    const url = `${this.baseUrl}/metadata/deployRequest`

    // Build multipart form data manually (no external deps)
    const boundary = `----FormBoundary${Date.now()}`
    const deployOptions = JSON.stringify({
      deployOptions: {
        rollbackOnError: true,
        singlePackage: true,
        rest: true,
      },
    })

    const parts: Buffer[] = []

    // JSON part
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="json"\r\n` +
          `Content-Type: application/json\r\n\r\n` +
          `${deployOptions}\r\n`
      )
    )

    // ZIP file part
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="deploy.zip"\r\n` +
          `Content-Type: application/zip\r\n\r\n`
      )
    )
    parts.push(zipBuffer)
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const body = Buffer.concat(parts)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(
        `Metadata deploy request failed (${res.status}): ${text}`
      )
    }

    const result = (await res.json()) as { id: string }
    return result.id
  }

  /**
   * Poll deploy status until complete.
   * Returns deploy result with success/failure info.
   */
  async waitForDeploy(
    deployId: string,
    timeoutMs = 300000
  ): Promise<DeployResult> {
    const startTime = Date.now()
    const pollInterval = 3000 // 3 seconds

    while (Date.now() - startTime < timeoutMs) {
      const url = `${this.baseUrl}/metadata/deployRequest/${deployId}?includeDetails=true`
      const res = await fetch(url, { headers: this.headers() })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(
          `Deploy status check failed (${res.status}): ${text}`
        )
      }

      const data = (await res.json()) as { deployResult: DeployResult }
      const result = data.deployResult

      if (result.done) {
        return result
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    throw new Error(`Deploy timed out after ${timeoutMs / 1000}s`)
  }
}

export class DuplicateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateError'
  }
}

export interface DeployResult {
  done: boolean
  success: boolean
  status: string
  numberComponentsDeployed: number
  numberComponentsTotal: number
  numberComponentErrors: number
  errorMessage?: string
  details?: {
    componentFailures?: Array<{
      componentType: string
      fullName: string
      problem: string
    }>
  }
}
