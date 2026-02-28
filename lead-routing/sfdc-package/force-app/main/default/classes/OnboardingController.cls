public with sharing class OnboardingController {

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Returns the web app base URL from Routing_Settings__c.App_Url__c.
     * Throws a user-friendly error if the setting hasn't been configured yet
     * (i.e. lead-routing sfdc deploy hasn't been run).
     */
    private static String getAppBaseUrl() {
        Routing_Settings__c s = Routing_Settings__c.getOrgDefaults();
        if (String.isBlank(s.App_Url__c)) {
            throw new AuraHandledException(
                'Lead Router App URL not configured. Run: lead-routing sfdc deploy'
            );
        }
        return s.App_Url__c.removeEnd('/') + '/api';
    }

    // ─── Init methods (called by LWC connectedCallback) ───────────────────────

    /**
     * Returns the web app URL for the LWC to use in OAuth popup and links.
     * Returns null if not yet configured.
     */
    @AuraEnabled
    public static String getAppUrl() {
        return Routing_Settings__c.getOrgDefaults().App_Url__c;
    }

    /**
     * Returns the Salesforce org ID for use in API calls.
     * Replaces the fragile window.location.hostname.split('.')[0] approach.
     */
    @AuraEnabled
    public static String getOrgId() {
        return UserInfo.getOrganizationId();
    }

    // ─── Step 1 ────────────────────────────────────────────────────────────────

    /**
     * Called by LWC polling: returns true once the web app has stored OAuth tokens
     * for this org (i.e. GET /api/setup/status?sfdcOrgId=xxx returns connected=true).
     */
    @AuraEnabled
    public static Boolean checkConnectionStatus(String sfdcOrgId) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(getAppBaseUrl() + '/setup/status?sfdcOrgId=' + EncodingUtil.urlEncode(sfdcOrgId, 'UTF-8'));
        req.setMethod('GET');
        req.setTimeout(8000);

        try {
            HttpResponse res = new Http().send(req);
            if (res.getStatusCode() == 200) {
                Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                return body.get('connected') == true;
            }
        } catch (Exception e) {
            // Swallow — LWC will keep polling
        }
        return false;
    }

    // ─── Step 2 ────────────────────────────────────────────────────────────────

    /**
     * Persists the admin's object/event selections to Routing_Settings__c.
     */
    @AuraEnabled
    public static void saveRoutingSettings(
        Boolean leadEnabled,    Boolean leadInsert,    Boolean leadUpdate,
        Boolean contactEnabled, Boolean contactInsert, Boolean contactUpdate,
        Boolean accountEnabled, Boolean accountInsert, Boolean accountUpdate
    ) {
        Routing_Settings__c s = Routing_Settings__c.getOrgDefaults();
        s.Lead_Routing_Enabled__c    = leadEnabled;
        s.Lead_Insert_Enabled__c     = leadInsert;
        s.Lead_Update_Enabled__c     = leadUpdate;
        s.Contact_Routing_Enabled__c = contactEnabled;
        s.Contact_Insert_Enabled__c  = contactInsert;
        s.Contact_Update_Enabled__c  = contactUpdate;
        s.Account_Routing_Enabled__c = accountEnabled;
        s.Account_Insert_Enabled__c  = accountInsert;
        s.Account_Update_Enabled__c  = accountUpdate;
        upsert s;
    }

    /**
     * Fires a test payload to the routing engine to verify connectivity.
     */
    @AuraEnabled
    public static void sendTestEvent() {
        Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();

        Map<String, Object> payload = new Map<String, Object>{
            'objectType' => 'LEAD',
            'eventType'  => 'INSERT',
            'recordId'   => '00Q000000000001EAA',
            'sfdcOrgId'  => UserInfo.getOrganizationId(),
            'timestamp'  => Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
            'fields'     => new Map<String, Object>{
                'FirstName'  => 'Test',
                'LastName'   => 'Event',
                'LeadSource' => 'Web'
            },
            'isTest' => true
        };

        String body = JSON.serialize(payload);
        String secret = settings.Webhook_Secret__c ?? '';
        String signature = 'sha256=' + hmacHex(body, secret);

        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:RoutingEngine/route');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('X-Sfdc-Org-Id', UserInfo.getOrganizationId());
        req.setHeader('X-Signature-256', signature);
        req.setBody(body);
        req.setTimeout(10000);

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200 && res.getStatusCode() != 202) {
            throw new AuraHandledException('Engine responded with ' + res.getStatusCode() + ': ' + res.getBody());
        }
    }

    // ─── Step 3 ────────────────────────────────────────────────────────────────

    /**
     * Triggers a field schema sync for one object type.
     * Calls POST /api/fields/sync?object=LEAD on the web app.
     * Returns the count of fields synced.
     */
    @AuraEnabled
    public static Integer syncFieldSchema(String objectType) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(getAppBaseUrl() + '/fields/sync?object=' + objectType);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('X-Sfdc-Org-Id', UserInfo.getOrganizationId());
        req.setTimeout(30000);

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new AuraHandledException('Sync failed for ' + objectType + ': ' + res.getBody());
        }

        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        return (Integer) body.get('synced');
    }

    // ─── Step 4 ────────────────────────────────────────────────────────────────

    /**
     * Marks onboarding as complete in the web app.
     */
    @AuraEnabled
    public static void markOnboardingDone() {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(getAppBaseUrl() + '/setup/onboarding-done');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('X-Sfdc-Org-Id', UserInfo.getOrganizationId());
        req.setTimeout(8000);
        new Http().send(req);
        // Best-effort — ignore errors
    }

    // ─── Private ───────────────────────────────────────────────────────────────

    private static String hmacHex(String payload, String secret) {
        if (String.isBlank(secret)) return '';
        Blob mac = Crypto.generateMac('hmacSHA256', Blob.valueOf(payload), Blob.valueOf(secret));
        return EncodingUtil.convertToHex(mac);
    }
}
