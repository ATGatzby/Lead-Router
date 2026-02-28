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

    if (!insertIds.isEmpty()) {
        RoutingEngineCallout.sendAsync('Lead', insertIds, 'INSERT');
    }
    if (!updateIds.isEmpty()) {
        RoutingEngineCallout.sendAsync('Lead', updateIds, 'UPDATE');
    }
}
