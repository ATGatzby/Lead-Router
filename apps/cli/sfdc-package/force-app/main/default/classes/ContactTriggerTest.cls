@isTest
class ContactTriggerTest {

    @TestSetup
    static void makeData() {
        Routing_Settings__c settings = new Routing_Settings__c(
            Contact_Routing_Enabled__c  = true,
            Contact_Insert_Enabled__c   = true,
            Contact_Update_Enabled__c   = true,
            Webhook_Secret__c           = 'test-secret-key',
            Engine_Endpoint__c          = 'https://engine.example.com'
        );
        upsert settings;
    }

    @isTest
    static void testContactInsertFiresCallout() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock());

        Test.startTest();
        Contact c = new Contact(
            FirstName = 'Ananya',
            LastName  = 'Singh',
            Email     = 'ananya@example.com'
        );
        insert c;
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c],
            'Expected no error logs for successful callout');
    }

    @isTest
    static void testContactUpdateFiresCallout() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock());

        Contact c = new Contact(FirstName = 'Dev', LastName = 'Kumar');
        insert c;

        Test.startTest();
        c.Email = 'dev@example.com';
        update c;
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c]);
    }

    @isTest
    static void testContactRoutingDisabled() {
        Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();
        settings.Contact_Routing_Enabled__c = false;
        upsert settings;

        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(500, 'should not be called'));

        Test.startTest();
        Contact c = new Contact(FirstName = 'No', LastName = 'Route');
        insert c;
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c]);
    }
}
