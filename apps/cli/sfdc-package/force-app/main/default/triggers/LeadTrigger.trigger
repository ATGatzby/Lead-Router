trigger LeadTrigger on Lead (after insert, after update) {

    Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();

    if (!settings.Lead_Routing_Enabled__c) return;

    List<Id> insertIds = new List<Id>();
    List<Id> updateIds = new List<Id>();

    if (Trigger.isInsert && settings.Lead_Insert_Enabled__c) {
        for (Lead l : Trigger.new) {
            insertIds.add(l.Id);
        }
    }

    if (Trigger.isUpdate && settings.Lead_Update_Enabled__c) {
        for (Lead l : Trigger.new) {
            updateIds.add(l.Id);
        }
    }

    // Chunk into batches of 100 to stay within Salesforce callout limits
    // (each @future context allows max 100 HTTP callouts)
    for (Integer i = 0; i < insertIds.size(); i += 100) {
        Integer endIdx = Math.min(i + 100, insertIds.size());
        List<Id> chunk = new List<Id>();
        for (Integer j = i; j < endIdx; j++) {
            chunk.add(insertIds[j]);
        }
        RoutingEngineCallout.sendAsync('Lead', chunk, 'INSERT');
    }
    for (Integer i = 0; i < updateIds.size(); i += 100) {
        Integer endIdx = Math.min(i + 100, updateIds.size());
        List<Id> chunk = new List<Id>();
        for (Integer j = i; j < endIdx; j++) {
            chunk.add(updateIds[j]);
        }
        RoutingEngineCallout.sendAsync('Lead', chunk, 'UPDATE');
    }
}
