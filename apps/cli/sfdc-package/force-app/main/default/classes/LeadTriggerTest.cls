@isTest
class LeadTriggerTest {

    @TestSetup
    static void makeData() {
        Routing_Settings__c settings = new Routing_Settings__c(
            Lead_Routing_Enabled__c  = true,
            Lead_Insert_Enabled__c   = true,
            Lead_Update_Enabled__c   = true,
            Webhook_Secret__c        = 'test-secret-key'
        );
        upsert settings;
    }

    @isTest
    static void testLeadInsertFiresCallout() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock());

        Test.startTest();
        Lead l = new Lead(
            FirstName  = 'Priya',
            LastName   = 'Sharma',
            Company    = 'Acme Corp',
            LeadSource = 'Web'
        );
        insert l;
        Test.stopTest();

        // No error logs expected for a 200 response
        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c],
            'Expected no error logs for successful callout');
    }

    @isTest
    static void testLeadUpdateFiresCallout() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock());

        Lead l = new Lead(
            FirstName  = 'Rahul',
            LastName   = 'Mehta',
            Company    = 'Beta LLC',
            LeadSource = 'Phone'
        );
        insert l;

        Test.startTest();
        l.LeadSource = 'Web';
        update l;
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c],
            'Expected no error logs for successful update callout');
    }

    @isTest
    static void testLeadInsertDisabledNoCallout() {
        Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();
        settings.Lead_Routing_Enabled__c = false;
        upsert settings;

        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(500, 'should not be called'));

        Test.startTest();
        Lead l = new Lead(
            FirstName  = 'Test',
            LastName   = 'Disabled',
            Company    = 'NoRoute Inc'
        );
        insert l;
        Test.stopTest();

        // No error logs because routing is disabled (no callout made)
        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c]);
    }

    @isTest
    static void testCalloutFailureLogsError() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(500, 'Internal Server Error'));

        Test.startTest();
        Lead l = new Lead(
            FirstName  = 'Error',
            LastName   = 'Test',
            Company    = 'Fail Corp',
            LeadSource = 'Web'
        );
        insert l;
        Test.stopTest();

        System.assertEquals(1, [SELECT COUNT() FROM Routing_Error_Log__c],
            'Expected one error log for 500 response');
        Routing_Error_Log__c errLog = [SELECT Status_Code__c FROM Routing_Error_Log__c LIMIT 1];
        System.assertEquals(500, (Integer) errLog.Status_Code__c);
    }
}
