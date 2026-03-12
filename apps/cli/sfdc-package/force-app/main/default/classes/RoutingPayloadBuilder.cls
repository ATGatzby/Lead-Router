public with sharing class RoutingPayloadBuilder {

    /**
     * Serialises a single SObject record into the JSON payload format
     * expected by the routing engine.
     *
     * Schema:
     * {
     *   "objectType": "LEAD",
     *   "eventType":  "INSERT",
     *   "recordId":   "00Q5g000001XyZEEA0",
     *   "sfdcOrgId":  "00D000000000001EAA",
     *   "timestamp":  "2026-02-23T10:32:00Z",
     *   "fields": { "FirstName": "Priya", "LeadSource": "Web", ... }
     * }
     */
    public static String build(String objectType, String eventType, SObject record) {
        Map<String, Object> payload = new Map<String, Object>{
            'objectType' => objectType.toUpperCase(),
            'eventType'  => eventType.toUpperCase(),
            'recordId'   => String.valueOf(record.get('Id')),
            'sfdcOrgId'  => UserInfo.getOrganizationId(),
            'timestamp'  => Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
            'fields'     => extractFields(record)
        };

        return JSON.serialize(payload);
    }

    /**
     * Serialises a batch of SObject records into the JSON payload format
     * expected by the engine's POST /route/batch endpoint.
     *
     * Schema:
     * {
     *   "objectType": "LEAD",
     *   "eventType":  "INSERT",
     *   "sfdcOrgId":  "00D000000000001EAA",
     *   "timestamp":  "2026-02-23T10:32:00Z",
     *   "records": [
     *     { "recordId": "00Q...", "fields": { ... } },
     *     ...
     *   ]
     * }
     */
    public static String buildBatch(String objectType, String eventType, List<SObject> records) {
        List<Map<String, Object>> recordList = new List<Map<String, Object>>();
        for (SObject record : records) {
            recordList.add(new Map<String, Object>{
                'recordId' => String.valueOf(record.get('Id')),
                'fields'   => extractFields(record)
            });
        }

        Map<String, Object> payload = new Map<String, Object>{
            'objectType' => objectType.toUpperCase(),
            'eventType'  => eventType.toUpperCase(),
            'sfdcOrgId'  => UserInfo.getOrganizationId(),
            'timestamp'  => Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
            'records'    => recordList
        };

        return JSON.serialize(payload);
    }

    // ─── Private ───────────────────────────────────────────────────────────────

    private static Map<String, Object> extractFields(SObject record) {
        Map<String, Object> fields = new Map<String, Object>();
        Map<String, Schema.SObjectField> fieldMap =
            record.getSObjectType().getDescribe().fields.getMap();

        for (String fieldName : fieldMap.keySet()) {
            try {
                Object value = record.get(fieldName);
                if (value != null) {
                    fields.put(fieldName, value);
                }
            } catch (SObjectException e) {
                // Field not retrieved in query — skip silently
            }
        }

        return fields;
    }
}
