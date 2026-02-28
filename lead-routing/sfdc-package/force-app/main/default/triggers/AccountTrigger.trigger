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

    if (!insertIds.isEmpty()) {
        RoutingEngineCallout.sendAsync('Account', insertIds, 'INSERT');
    }
    if (!updateIds.isEmpty()) {
        RoutingEngineCallout.sendAsync('Account', updateIds, 'UPDATE');
    }
}
