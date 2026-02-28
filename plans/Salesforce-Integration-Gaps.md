# Plan: Salesforce Integration Gaps — 4 Work Items

## Context

The self-hosted CLI (`lead-routing init`) deploys the Docker stack but has four critical Salesforce-side gaps:
1. No automated Salesforce package deployment — customers must know SFDX CLI commands
2. `OnboardingController.cls` and `onboardingWizard.js` hardcode `https://app.leadrouter.io` — the LWC wizard breaks for every self-hosted customer
3. `Engine_Endpoint__c` in `Routing_Settings__c` is defined but never written to
4. Named Credential (`RoutingEngine`) and Remote Site Setting are hardcoded to a dev ngrok URL — every real customer's callouts fail

---

## Work Item 1: CLI — `lead-routing sfdc deploy` command

### What it does
New command that bundles and deploys the SFDC package into the customer's Salesforce org, pre-patched with their actual engine/app URLs, and writes org settings so the LWC wizard boots with the correct URL.

### Chicken-and-egg solution
The CLI knows engine URL + app URL from `lead-routing.json`. After package deploy it runs `sf data upsert record` (no OAuth needed — uses the org alias just authenticated) to write `App_Url__c` and `Engine_Endpoint__c` into `Routing_Settings__c`. So when the LWC wizard first opens, `App_Url__c` is already set.

### Implementation steps in `runSfdcDeploy()`

1. `findInstallDir()` + `readConfig()` — exit with error if not found
2. Check `sf --version` is installed; if not, print install URL + manual deploy command and exit
3. Prompt: "Salesforce org alias or login username"
4. Spinner: run `sf org login web --alias <alias>` (opens browser)
5. Spinner: "Copying Salesforce package…" — copy bundled `sfdc-package/` to `{installDir}/sfdc-package/`
6. **Patch Named Credential XML**: replace `<endpoint>` with config's `engineUrl`
7. **Patch Remote Site Setting XML**: replace `<url>` with config's `engineUrl`, update `<description>`
8. Spinner: "Deploying Salesforce package (this takes ~2 min)…" — run:
   ```bash
   sf project deploy start --target-org <alias> \
     --metadata ApexClass,ApexTrigger,CustomObject,NamedCredential,LightningComponentBundle,RemoteSiteSettings \
     --source-dir force-app
   ```
   (cwd = `{installDir}/sfdc-package`)
9. Spinner: "Writing org settings…" — run:
   ```bash
   sf data upsert record --target-org <alias> \
     --sobject Routing_Settings__c \
     --values "App_Url__c='{appUrl}' Engine_Endpoint__c='{engineUrl}'"
   ```
10. Print success + next steps: open Salesforce App Launcher → Lead Router Setup → complete 4-step wizard

### Bundling sfdc-package into the CLI npm package

- Add a `prepare` script in `apps/cli/package.json` that copies `../../sfdc-package` → `apps/cli/sfdc-package`
- Add `"sfdc-package"` to the `"files"` array in `apps/cli/package.json`
- In `tsup.config.ts`, add an `onSuccess` hook that copies `apps/cli/sfdc-package` → `apps/cli/dist/sfdc-package` so the dist is self-contained
- At runtime, resolve package path via `path.resolve(fileURLToPath(import.meta.url), '../../sfdc-package')`

### Register new command in `index.ts`

```typescript
const sfdc = program
  .command('sfdc')
  .description('Manage the Salesforce package for this installation')

sfdc
  .command('deploy')
  .description('Deploy (or redeploy) the Lead Router Salesforce package to your org')
  .action(runSfdcDeploy)
```

### Update `init` outro

Add after success lines:
```
  Next: run lead-routing sfdc deploy to install the
        Salesforce package (triggers + onboarding wizard)
```

### Files
| File | Action |
|---|---|
| `apps/cli/src/commands/sfdc.ts` | **Create** — `runSfdcDeploy()` |
| `apps/cli/src/index.ts` | Register `sfdc deploy` subcommand group |
| `apps/cli/src/commands/init.ts` | Add next-step hint to outro |
| `apps/cli/package.json` | Add `prepare` script + `sfdc-package` to `files` |
| `apps/cli/tsup.config.ts` | Add `onSuccess` to copy sfdc-package → dist |

---

## Work Item 2: Named Credential + Remote Site Setting via jsforce Metadata API

### What it does
After OAuth connect in the web app, automatically update the Named Credential endpoint and Remote Site Setting URL in the customer's org to point to their actual engine URL.

### New `pushSettings()` in `packages/sfdc/src/settings.ts`

Replace `pushWebhookSecret(conn, secret)` with `pushSettings(conn, payload)`:

```typescript
export interface PushSettingsPayload {
  webhookSecret: string
  engineUrl: string   // e.g. "https://engine.acme.com"
  appUrl: string      // e.g. "https://routing.acme.com"
}

export async function pushSettings(conn: Connection, payload: PushSettingsPayload): Promise<void> {
  const { webhookSecret, engineUrl, appUrl } = payload

  // 1. Update Routing_Settings__c org defaults (data API)
  const result = await conn.query<{ Id: string }>("SELECT Id FROM Routing_Settings__c LIMIT 1")
  const record = { Webhook_Secret__c: webhookSecret, Engine_Endpoint__c: engineUrl, App_Url__c: appUrl }
  if (result.totalSize > 0) {
    await conn.sobject('Routing_Settings__c').update({ Id: result.records[0].Id, ...record })
  } else {
    await conn.sobject('Routing_Settings__c').create(record)
  }

  // 2. Upsert Named Credential (Metadata API) — non-fatal on failure
  try {
    await (conn as any).metadata.upsert('NamedCredential', [{
      fullName: 'RoutingEngine', label: 'Routing Engine', endpoint: engineUrl,
      principalType: 'Anonymous', protocol: 'NoAuthentication',
      allowMergeFieldsInBody: false, allowMergeFieldsInHeader: false,
      generateAuthorizationHeader: false,
    }])
  } catch (err) { console.error('[pushSettings] Named Credential upsert failed:', err) }

  // 3. Upsert Remote Site Setting (Metadata API) — non-fatal on failure
  try {
    await (conn as any).metadata.upsert('RemoteSiteSettings', [{
      fullName: 'LeadRouterEngine', description: 'Lead Router Engine endpoint',
      isActive: true, url: engineUrl, disableProtocolSecurity: false,
    }])
  } catch (err) { console.error('[pushSettings] Remote Site Setting upsert failed:', err) }
}

// Backward-compat shim for any remaining direct callers
export const pushWebhookSecret = (conn: Connection, secret: string) =>
  pushSettings(conn, {
    webhookSecret: secret,
    engineUrl: process.env.ENGINE_URL ?? 'http://localhost:3001',
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  })
```

### Update all callers

In each file, change `pushWebhookSecret(conn, secret)` → `pushSettings(conn, { webhookSecret: ..., engineUrl: process.env.ENGINE_URL!, appUrl: process.env.APP_URL! })`:

- `apps/web/app/api/auth/sfdc/callback/route.ts`
- `apps/web/app/api/setup/onboarding-done/route.ts`
- `apps/web/app/api/settings/sync-sfdc/route.ts` (if it exists)

### Rename Remote Site Setting file in sfdc-package

Rename `LeadRouterNgrok.remoteSite-meta.xml` → `LeadRouterEngine.remoteSite-meta.xml`
Clear the URL to a placeholder (CLI will patch it before deploy).

### Files
| File | Action |
|---|---|
| `packages/sfdc/src/settings.ts` | Replace `pushWebhookSecret` with `pushSettings` + compat shim |
| `packages/sfdc/src/index.ts` | Export `pushSettings` |
| `apps/web/app/api/auth/sfdc/callback/route.ts` | Use `pushSettings` |
| `apps/web/app/api/setup/onboarding-done/route.ts` | Use `pushSettings` |
| `sfdc-package/.../LeadRouterNgrok.remoteSite-meta.xml` | Rename → `LeadRouterEngine.remoteSite-meta.xml`, clear URL |

---

## Work Item 3: Engine_Endpoint__c — push engine URL

**Fully absorbed by Work Item 2.** The new `pushSettings()` writes `Engine_Endpoint__c` alongside `Webhook_Secret__c` and `App_Url__c` in the same upsert. No additional files.

---

## Work Item 4: Fix hardcoded URLs in Apex + LWC

### New field: `App_Url__c` on `Routing_Settings__c`

**Create:** `sfdc-package/force-app/main/default/objects/Routing_Settings__c/fields/App_Url__c.field-meta.xml`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>App_Url__c</fullName>
    <label>App URL</label>
    <length>255</length>
    <type>Text</type>
    <unique>false</unique>
</CustomField>
```

### `OnboardingController.cls` changes

Remove `private static final String APP_BASE_URL = 'https://app.leadrouter.io/api'`.

Add three methods:
```apex
@AuraEnabled
public static String getAppUrl() {
    return Routing_Settings__c.getOrgDefaults().App_Url__c;
}

@AuraEnabled
public static String getOrgId() {
    return UserInfo.getOrganizationId();
}

private static String getAppBaseUrl() {
    Routing_Settings__c s = Routing_Settings__c.getOrgDefaults();
    if (String.isBlank(s.App_Url__c)) {
        throw new AuraHandledException(
            'Lead Router not configured. Run: lead-routing sfdc deploy'
        );
    }
    return s.App_Url__c.removeEnd('/') + '/api';
}
```

Replace all `APP_BASE_URL + '/...'` usages with `getAppBaseUrl() + '/...'` in `checkConnectionStatus`, `syncFieldSchema`, `markOnboardingDone`.

### `onboardingWizard.js` changes

Remove `const APP_URL = 'https://app.leadrouter.io'`.

Import new Apex methods:
```javascript
import getAppUrl from '@salesforce/apex/OnboardingController.getAppUrl';
import getOrgId  from '@salesforce/apex/OnboardingController.getOrgId';
```

Add reactive properties:
```javascript
@track _appUrl = null;
@track _sfdcOrgId = null;
@track isLoading = true;
@track initError = null;
```

Add `connectedCallback()`:
```javascript
async connectedCallback() {
    try {
        const [appUrl, orgId] = await Promise.all([getAppUrl(), getOrgId()]);
        if (!appUrl) {
            this.initError = 'App URL not set. Run: lead-routing sfdc deploy';
            return;
        }
        this._appUrl = appUrl;
        this._sfdcOrgId = orgId;
    } catch (e) {
        this.initError = this._errorMsg(e);
    } finally {
        this.isLoading = false;
    }
}
```

Replace `APP_URL` → `this._appUrl`, `this._getSfdcOrgId()` → `this._sfdcOrgId`, remove `_getSfdcOrgId()`.

### `onboardingWizard.html` changes

Wrap main content in conditional rendering:
```html
<template lwc:if={isLoading}>
    <lightning-spinner alternative-text="Loading…"></lightning-spinner>
</template>
<template lwc:elseif={initError}>
    <div class="slds-text-color_error">{initError}</div>
</template>
<template lwc:else>
    <!-- existing step template content -->
</template>
```

### Files
| File | Action |
|---|---|
| `sfdc-package/.../fields/App_Url__c.field-meta.xml` | **Create** — new custom field |
| `sfdc-package/.../classes/OnboardingController.cls` | Remove hardcoded URL, add `getAppUrl()`, `getOrgId()`, `getAppBaseUrl()` |
| `sfdc-package/.../lwc/onboardingWizard/onboardingWizard.js` | Remove hardcoded URL, add `connectedCallback`, use `this._appUrl` / `this._sfdcOrgId` |
| `sfdc-package/.../lwc/onboardingWizard/onboardingWizard.html` | Add loading + error template blocks |

---

## Implementation Order

1. **Work Items 2 + 3** — `packages/sfdc/src/settings.ts` + web app callers + rename remote site setting XML
2. **Work Item 4** — SFDC package files (new field, Apex, LWC)
3. **Work Item 1** — CLI `sfdc deploy` command (depends on final state of the SFDC package)

---

## End-to-End Customer Flow After All 4 Items

```
lead-routing init
  → Docker stack up, web app + engine healthy

lead-routing sfdc deploy
  → sf org login web → authenticate
  → Copy + patch sfdc-package (Named Credential = engine URL)
  → sf project deploy start → ApexTrigger, OnboardingController, LWC, etc.
  → sf data upsert record → App_Url__c = APP_URL, Engine_Endpoint__c = ENGINE_URL

In Salesforce App Launcher → Lead Router Setup (LWC opens)
  → connectedCallback reads App_Url__c via getAppUrl() ✔
  → Step 1: Click Connect → opens {appUrl}/auth/sfdc?sfdcOrgId={orgId} ✔
  → OAuth completes → web app calls pushSettings() → Named Credential synced again
  → Step 2: Toggle objects/events → saved to Routing_Settings__c
  → Step 3: Field schema sync
  → Step 4: Onboarding done

Lead created in Salesforce
  → LeadTrigger fires → callout:RoutingEngine/route (correct URL) ✔
  → Engine validates HMAC → routes lead → updates OwnerId ✔
```

---

## Verification

1. `lead-routing sfdc deploy` completes without errors
2. Salesforce Setup → Named Credentials: `RoutingEngine` endpoint = engine URL ✔
3. Salesforce Setup → Remote Site Settings: `LeadRouterEngine` URL = engine URL ✔
4. Salesforce Custom Settings → Routing Settings → Manage: `App_Url__c` and `Engine_Endpoint__c` are set ✔
5. Open LWC wizard: loads without `undefined` URL errors, Step 1 button opens correct APP_URL ✔
6. Complete OAuth → web app logs show `pushSettings` called with all three values ✔
7. Create test lead → routing history shows success ✔
8. `Technical-Implementation.md` updated to reflect all changes ✔
