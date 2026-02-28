# Phase 7 — Salesforce Managed Package

**Duration:** Week 8–10
**Status:** ⬜ Not Started
**Depends on:** Phase 5 (routing engine is live and accepting events)
**Requires:** Salesforce Developer Edition org (available)

---

## Goal
Build the Salesforce managed package that installs into customer orgs and acts as the thin event emitter. When a Lead, Contact, or Account is created or updated in Salesforce, the Apex trigger fires and sends the record payload to the routing engine. Zero business logic lives in Apex — it is purely a data relay.

---

## Deliverables
- [ ] Apex Triggers for Lead, Contact, and Account (Insert/Update)
- [ ] Named Credential for routing engine endpoint
- [ ] Connected App configuration for OAuth
- [ ] LWC Onboarding Wizard (post-install setup flow)
- [ ] Field schema sync endpoint in web app (triggered from SFDC)
- [ ] Callout HTTP class (shared by all triggers)
- [ ] Test coverage for Apex (≥75% required by Salesforce)
- [ ] End-to-end validation with Developer org

---

## Package Structure

```
sfdc-package/
└── force-app/
    └── main/
        └── default/
            ├── triggers/
            │   ├── LeadTrigger.trigger
            │   ├── LeadTrigger.trigger-meta.xml
            │   ├── ContactTrigger.trigger
            │   ├── ContactTrigger.trigger-meta.xml
            │   ├── AccountTrigger.trigger
            │   └── AccountTrigger.trigger-meta.xml
            ├── classes/
            │   ├── RoutingEngineCallout.cls          ← shared callout handler
            │   ├── RoutingEngineCallout.cls-meta.xml
            │   ├── RoutingPayloadBuilder.cls         ← builds JSON from SObject
            │   ├── RoutingPayloadBuilder.cls-meta.xml
            │   ├── LeadTriggerTest.cls               ← test class
            │   └── ContactTriggerTest.cls
            ├── namedCredentials/
            │   └── RoutingEngine.namedCredential-meta.xml
            ├── connectedApps/
            │   └── LeadRoutingApp.connectedApp-meta.xml
            └── lwc/
                └── onboardingWizard/
                    ├── onboardingWizard.html
                    ├── onboardingWizard.js
                    └── onboardingWizard.js-meta.xml
```

---

## Apex Trigger — Lead

```apex
// sfdc-package/force-app/main/default/triggers/LeadTrigger.trigger
trigger LeadTrigger on Lead (after insert, after update) {

    // Get the org's trigger settings (which events are enabled)
    // Settings stored in custom metadata or custom settings installed with package
    Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();

    if (!settings.Lead_Routing_Enabled__c) return;

    List<Lead> recordsToRoute = new List<Lead>();

    if (Trigger.isInsert && settings.Lead_Insert_Enabled__c) {
        recordsToRoute.addAll(Trigger.new);
    }

    if (Trigger.isUpdate && settings.Lead_Update_Enabled__c) {
        recordsToRoute.addAll(Trigger.new);
    }

    if (!recordsToRoute.isEmpty()) {
        // Fire callout asynchronously to avoid Apex governor limits
        RoutingEngineCallout.sendAsync('Lead', recordsToRoute);
    }
}
```

**Note on async:** Apex triggers cannot make synchronous HTTP callouts during the same transaction. Use `@future(callout=true)` for async callout or a Queueable Apex class for better error handling.

---

## Apex Callout Class

```apex
// sfdc-package/force-app/main/default/classes/RoutingEngineCallout.cls
public class RoutingEngineCallout {

    @future(callout=true)
    public static void sendAsync(String objectType, List<Id> recordIds) {
        // Re-query records to get all fields (triggers only get changed fields)
        List<SObject> records = queryRecords(objectType, recordIds);

        for (SObject record : records) {
            String payload = RoutingPayloadBuilder.build(objectType, record);
            sendPayload(payload);
        }
    }

    private static void sendPayload(String payload) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:RoutingEngine/route');  // Named Credential
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('X-Org-Id', UserInfo.getOrganizationId());
        req.setBody(payload);
        req.setTimeout(10000);  // 10 second timeout

        Http http = new Http();
        HttpResponse res = http.send(req);

        if (res.getStatusCode() != 200) {
            // Log error to custom object for visibility
            insert new Routing_Error_Log__c(
                Payload__c = payload,
                Status_Code__c = res.getStatusCode(),
                Response_Body__c = res.getBody(),
                Created_At__c = Datetime.now()
            );
        }
    }
}
```

---

## Payload Builder

```apex
// sfdc-package/force-app/main/default/classes/RoutingPayloadBuilder.cls
public class RoutingPayloadBuilder {

    public static String build(String objectType, SObject record) {
        Map<String, Object> payload = new Map<String, Object>{
            'objectType' => objectType.toUpperCase(),
            'eventType'  => 'INSERT',  // determined by caller
            'recordId'   => String.valueOf(record.get('Id')),
            'timestamp'  => Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
            'fields'     => getFieldMap(record)
        };

        return JSON.serialize(payload);
    }

    private static Map<String, Object> getFieldMap(SObject record) {
        Map<String, Object> fields = new Map<String, Object>();
        Map<String, Schema.SObjectField> fieldMap =
            record.getSObjectType().getDescribe().fields.getMap();

        for (String fieldName : fieldMap.keySet()) {
            Object value = record.get(fieldName);
            if (value != null) {
                fields.put(fieldName, value);
            }
        }
        return fields;
    }
}
```

---

## Named Credential

```xml
<!-- sfdc-package/.../namedCredentials/RoutingEngine.namedCredential-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<NamedCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Routing Engine</label>
    <name>RoutingEngine</name>
    <endpoint>https://your-engine-url.com/api</endpoint>
    <principalType>Anonymous</principalType>
    <protocol>NoAuthentication</protocol>
    <!-- Auth handled via HMAC signature in header — no OAuth on Named Credential -->
</NamedCredential>
```

The routing engine URL is configurable post-install via a custom setting, allowing customers to point to their specific engine endpoint.

---

## LWC Onboarding Wizard

The onboarding wizard is a Lightning Web Component that guides the SFDC Admin through setup:

**Step 1: Connect Your Org**
- Display a button: "Connect to Lead Router"
- Clicking opens `https://app.leadrouter.io/auth/sfdc?orgId={sfdcOrgId}` in a new tab
- Web app completes OAuth and stores tokens
- Wizard polls `GET /api/setup/status?orgId=xxx` to confirm connection

**Step 2: Activate Objects & Triggers**
- Checkboxes: Lead (Insert / Update), Contact (Insert / Update), Account (Insert / Update)
- Saves selections to `Routing_Settings__c` custom setting
- "Send Test Event" button — fires a fake payload to engine to verify connectivity

**Step 3: Sync Field Schema**
- Button: "Sync Fields" — calls `POST /api/fields/sync` for each activated object
- Confirms how many fields were synced: "127 Lead fields synced ✓"

**Step 4: Done**
- "Go to Lead Router →" — opens the web app in new tab
- Onboarding flag saved so wizard doesn't show again

---

## Custom Metadata / Settings Objects (installed with package)

```
Routing_Settings__c (Custom Setting — Org Defaults)
  Lead_Routing_Enabled__c     (Boolean)
  Lead_Insert_Enabled__c      (Boolean)
  Lead_Update_Enabled__c      (Boolean)
  Contact_Routing_Enabled__c  (Boolean)
  Contact_Insert_Enabled__c   (Boolean)
  Contact_Update_Enabled__c   (Boolean)
  Account_Routing_Enabled__c  (Boolean)
  Account_Insert_Enabled__c   (Boolean)
  Account_Update_Enabled__c   (Boolean)
  Engine_Endpoint__c          (Text — routing engine URL)
  Webhook_Secret__c           (Text — HMAC secret)

Routing_Error_Log__c (Custom Object — for visibility into callout failures)
  Payload__c          (Long Text)
  Status_Code__c      (Number)
  Response_Body__c    (Long Text)
  Created_At__c       (DateTime)
```

---

## Apex Test Coverage

Salesforce requires ≥75% test coverage to deploy to production and pass AppExchange security review.

```apex
// LeadTriggerTest.cls
@isTest
class LeadTriggerTest {

    @isTest
    static void testLeadInsertFiresCallout() {
        // Set up mock HTTP callout
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock());

        // Enable routing settings
        Routing_Settings__c settings = new Routing_Settings__c(
            Lead_Routing_Enabled__c = true,
            Lead_Insert_Enabled__c = true
        );
        upsert settings;

        Test.startTest();
        Lead l = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Acme',
            LeadSource = 'Web'
        );
        insert l;
        Test.stopTest();

        // Verify callout was made (mock captures it)
        // Verify no Routing_Error_Log__c records created
        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c]);
    }
}
```

---

## AppExchange Considerations

| Step | Notes |
|---|---|
| Developer org testing | Use our available Developer org — validate all trigger events |
| Packaging | Create a managed package in a dedicated Packaging org (separate from Dev org) |
| Security Review | Submit to Salesforce AppExchange security review — 6–8 week process |
| Namespacing | Choose a package namespace early (e.g., `lrt` for Lead Router) — cannot change later |
| Partner account | Requires Salesforce ISV/OEM Partner account for AppExchange listing |

**For MVP / early customers:** Skip AppExchange. Distribute as an unmanaged package via direct install link (`/packaging/installPackage.apexp?p0={packageId}`). AppExchange listing comes post-MVP.

---

## Key Files

| File | Purpose |
|---|---|
| `sfdc-package/.../triggers/LeadTrigger.trigger` | Lead Insert/Update handler |
| `sfdc-package/.../triggers/ContactTrigger.trigger` | Contact handler |
| `sfdc-package/.../triggers/AccountTrigger.trigger` | Account handler |
| `sfdc-package/.../classes/RoutingEngineCallout.cls` | Async HTTP callout |
| `sfdc-package/.../classes/RoutingPayloadBuilder.cls` | JSON payload serialization |
| `sfdc-package/.../lwc/onboardingWizard/` | LWC setup wizard |
| `sfdc-package/.../namedCredentials/RoutingEngine.namedCredential-meta.xml` | Engine endpoint config |

---

## Verification Checklist
- [ ] Deploy package to Developer org via SFDX (`sf project deploy start`)
- [ ] Create a Lead in Developer org → engine receives payload within 5 seconds
- [ ] Update a Lead → engine receives UPDATE event
- [ ] Engine routes the record → Lead Owner updates in Salesforce
- [ ] Disable Lead routing in settings → trigger fires but no callout sent
- [ ] Callout failure → `Routing_Error_Log__c` record created in SFDC
- [ ] Apex test coverage ≥ 75% (`sf apex test run`)
- [ ] Onboarding wizard completes all 4 steps successfully
- [ ] Field schema sync via wizard pulls all Lead fields into web app
