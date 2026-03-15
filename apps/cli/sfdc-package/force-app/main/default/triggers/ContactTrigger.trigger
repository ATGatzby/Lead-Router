trigger ContactTrigger on Contact (after insert, after update) {

    Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();

    if (!settings.Contact_Routing_Enabled__c) return;

    List<Id> insertIds = new List<Id>();
    List<Id> updateIds = new List<Id>();

    if (Trigger.isInsert && settings.Contact_Insert_Enabled__c) {
        for (Contact c : Trigger.new) {
            insertIds.add(c.Id);
        }
    }

    if (Trigger.isUpdate && settings.Contact_Update_Enabled__c) {
        for (Contact c : Trigger.new) {
            Contact old = Trigger.oldMap.get(c.Id);
            // Skip if the routing engine just stamped this record
            if (c.Routing_Action__c != old.Routing_Action__c
                && c.Routing_Action__c != null
                && c.Routing_Action__c.startsWith('assigned')) continue;
            updateIds.add(c.Id);
        }
    }

    for (Integer i = 0; i < insertIds.size(); i += 100) {
        Integer endIdx = Math.min(i + 100, insertIds.size());
        List<Id> chunk = new List<Id>();
        for (Integer j = i; j < endIdx; j++) {
            chunk.add(insertIds[j]);
        }
        RoutingEngineCallout.sendAsync('Contact', chunk, 'INSERT');
    }
    for (Integer i = 0; i < updateIds.size(); i += 100) {
        Integer endIdx = Math.min(i + 100, updateIds.size());
        List<Id> chunk = new List<Id>();
        for (Integer j = i; j < endIdx; j++) {
            chunk.add(updateIds[j]);
        }
        RoutingEngineCallout.sendAsync('Contact', chunk, 'UPDATE');
    }
}
