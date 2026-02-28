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
            updateIds.add(c.Id);
        }
    }

    if (!insertIds.isEmpty()) {
        RoutingEngineCallout.sendAsync('Contact', insertIds, 'INSERT');
    }
    if (!updateIds.isEmpty()) {
        RoutingEngineCallout.sendAsync('Contact', updateIds, 'UPDATE');
    }
}
