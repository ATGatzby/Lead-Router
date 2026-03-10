trigger AccountTrigger on Account (after insert, after update) {

    Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();

    if (!settings.Account_Routing_Enabled__c) return;

    List<Id> insertIds = new List<Id>();
    List<Id> updateIds = new List<Id>();

    if (Trigger.isInsert && settings.Account_Insert_Enabled__c) {
        for (Account a : Trigger.new) {
            insertIds.add(a.Id);
        }
    }

    if (Trigger.isUpdate && settings.Account_Update_Enabled__c) {
        for (Account a : Trigger.new) {
            updateIds.add(a.Id);
        }
    }

    for (Integer i = 0; i < insertIds.size(); i += 100) {
        Integer endIdx = Math.min(i + 100, insertIds.size());
        List<Id> chunk = new List<Id>();
        for (Integer j = i; j < endIdx; j++) {
            chunk.add(insertIds[j]);
        }
        RoutingEngineCallout.sendAsync('Account', chunk, 'INSERT');
    }
    for (Integer i = 0; i < updateIds.size(); i += 100) {
        Integer endIdx = Math.min(i + 100, updateIds.size());
        List<Id> chunk = new List<Id>();
        for (Integer j = i; j < endIdx; j++) {
            chunk.add(updateIds[j]);
        }
        RoutingEngineCallout.sendAsync('Account', chunk, 'UPDATE');
    }
}
