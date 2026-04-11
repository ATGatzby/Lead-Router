import type { HubSpotClient } from './client';
import type { ExportRequest, ExportStatus } from './types';

/**
 * HubSpot CRM Export API — async bulk export of CRM objects.
 *
 * Constraints:
 * - 30 exports per rolling 24 hours
 * - 1 concurrent export per portal
 * - Download URL expires in 5 minutes
 * - CSVs > 2MB auto-zipped; > 1M rows delivered as multi-file ZIP
 */
export class ExportApi {
  constructor(private client: HubSpotClient) {}

  /**
   * Start an async CRM export.
   * Returns the export task ID for polling.
   */
  async startExport(request: ExportRequest): Promise<{ id: string }> {
    return this.client.post<{ id: string }>(
      '/crm/v3/exports/export/async',
      request,
    );
  }

  /**
   * Poll the status of an export task.
   * When status is 'COMPLETE', `result` contains a signed download URL (5-min expiry).
   */
  async getExportStatus(exportId: string): Promise<ExportStatus> {
    return this.client.get<ExportStatus>(
      `/crm/v3/exports/export/async/tasks/${exportId}/status`,
    );
  }

  /**
   * Download the exported file from the signed URL.
   * The URL is a pre-signed S3 URL — no auth header needed.
   * Returns the raw Response so the caller can stream large files.
   */
  async downloadExport(url: string): Promise<Response> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Export download failed: ${res.status} ${res.statusText}`);
    }
    return res;
  }
}
