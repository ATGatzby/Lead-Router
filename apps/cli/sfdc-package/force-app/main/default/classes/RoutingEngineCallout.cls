public with sharing class RoutingEngineCallout {

    // ─── Public API ────────────────────────────────────────────────────────────

    /**
     * Called from triggers. @future ensures the callout runs outside the
     * trigger transaction, avoiding mixed-DML and callout-in-trigger errors.
     *
     * @param objectType  'Lead' | 'Contact' | 'Account' (Pascal case)
     * @param recordIds   IDs of records to route
     * @param eventType   'INSERT' | 'UPDATE'
     */
    @future(callout=true)
    public static void sendAsync(String objectType, List<Id> recordIds, String eventType) {
        Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();
        String secret = settings.Webhook_Secret__c;
        String engineEndpoint = settings.Engine_Endpoint__c;

        if (String.isBlank(engineEndpoint)) {
            System.debug('RoutingEngineCallout: Engine_Endpoint__c not configured. Run: lead-routing sfdc deploy');
            return;
        }

        List<SObject> records = queryRecords(objectType, recordIds);

        // Filter records through trigger criteria before making the callout.
        // Records that don't match any active rule's pre-callout conditions are dropped here
        // so the engine never sees them. No criteria configured → all records pass.
        records = CriteriaEvaluator.filter(records, objectType, eventType);
        if (records.isEmpty()) {
            System.debug('RoutingEngineCallout: all records filtered by trigger criteria — skipping callout');
            return;
        }

        // Send all records in a single batch HTTP call to /route/batch
        String batchPayload = RoutingPayloadBuilder.buildBatch(objectType, eventType, records);
        sendBatchPayload(batchPayload, secret, engineEndpoint);
    }

    // ─── Private helpers ───────────────────────────────────────────────────────

    private static List<SObject> queryRecords(String objectType, List<Id> recordIds) {
        // Dynamically build SELECT with all standard fields for the object
        Schema.SObjectType sObjType = Schema.getGlobalDescribe().get(objectType);
        Map<String, Schema.SObjectField> fieldMap = sObjType.getDescribe().fields.getMap();
        List<String> fieldNames = new List<String>(fieldMap.keySet());

        String soql = 'SELECT ' + String.join(fieldNames, ', ')
            + ' FROM ' + objectType
            + ' WHERE Id IN :recordIds';

        return Database.query(soql);
    }

    private static void sendBatchPayload(String payload, String secret, String engineEndpoint) {
        String signature = hmacSha256(payload, secret);

        HttpRequest req = new HttpRequest();
        req.setEndpoint(engineEndpoint.removeEnd('/') + '/route/batch');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('X-Sfdc-Org-Id', UserInfo.getOrganizationId());
        req.setHeader('X-Signature-256', 'sha256=' + signature);
        req.setBody(payload);
        req.setTimeout(30000); // 30s for batch

        Http http = new Http();
        HttpResponse res;

        try {
            res = http.send(req);
        } catch (Exception e) {
            logError(payload, 0, 'Batch callout exception: ' + e.getMessage());
            return;
        }

        if (res.getStatusCode() != 200 && res.getStatusCode() != 202) {
            logError(payload, res.getStatusCode(), res.getBody());
        }
    }

    // Kept for backward compatibility (single-record POST to /route)
    private static void sendPayload(String payload, String secret, String engineEndpoint) {
        String signature = hmacSha256(payload, secret);

        HttpRequest req = new HttpRequest();
        req.setEndpoint(engineEndpoint.removeEnd('/') + '/route');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('X-Sfdc-Org-Id', UserInfo.getOrganizationId());
        req.setHeader('X-Signature-256', 'sha256=' + signature);
        req.setBody(payload);
        req.setTimeout(10000);

        Http http = new Http();
        HttpResponse res;

        try {
            res = http.send(req);
        } catch (Exception e) {
            logError(payload, 0, 'Callout exception: ' + e.getMessage());
            return;
        }

        if (res.getStatusCode() != 200 && res.getStatusCode() != 202) {
            logError(payload, res.getStatusCode(), res.getBody());
        }
    }

    private static String hmacSha256(String payload, String secret) {
        if (String.isBlank(secret)) return '';
        Blob hmac = Crypto.generateMac(
            'hmacSHA256',
            Blob.valueOf(payload),
            Blob.valueOf(secret)
        );
        return EncodingUtil.convertToHex(hmac);
    }

    private static void logError(String payload, Integer statusCode, String responseBody) {
        try {
            insert new Routing_Error_Log__c(
                Payload__c = payload.length() > 131072 ? payload.substring(0, 131072) : payload,
                Status_Code__c = statusCode,
                Response_Body__c = responseBody,
                Created_At__c = Datetime.now()
            );
        } catch (Exception ex) {
            System.debug('Failed to insert Routing_Error_Log__c: ' + ex.getMessage());
        }
    }
}
