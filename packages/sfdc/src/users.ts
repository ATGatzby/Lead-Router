import { Connection } from "jsforce";

export interface SfdcUserRecord {
  Id: string;
  Name: string;
  Email: string;
  UserRole: { Name: string } | null;
  Profile: { Name: string } | null;
  Department: string | null;
  IsActive: boolean;
  LastLoginDate: string | null;
}

export interface UserSyncResult {
  upserted: number;
  deactivated: number;
}

/**
 * Fetch all active users from a Salesforce org.
 * Handles pagination automatically via jsforce queryMore.
 */
export async function fetchActiveSfdcUsers(
  conn: Connection
): Promise<SfdcUserRecord[]> {
  const result = await conn.query<SfdcUserRecord>(
    `SELECT Id, Name, Email,
            UserRole.Name, Profile.Name, Department,
            IsActive, LastLoginDate
     FROM User
     WHERE IsActive = true
     ORDER BY Name ASC`
  );

  // jsforce handles the full result set; cast for the typed records
  const typed = result as unknown as {
    done: boolean;
    nextRecordsUrl?: string;
    records: SfdcUserRecord[];
  };

  let records = [...typed.records];

  // Paginate if there are more than 2000 records
  while (!typed.done && typed.nextRecordsUrl) {
    const next = (await conn.queryMore(
      typed.nextRecordsUrl
    )) as unknown as typeof typed;
    records = [...records, ...next.records];
    typed.done = next.done;
    typed.nextRecordsUrl = next.nextRecordsUrl;
  }

  return records;
}
