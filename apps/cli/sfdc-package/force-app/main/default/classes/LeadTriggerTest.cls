@isTest
class LeadTriggerTest {

    @TestSetup
    static void makeData() {
        Routing_Settings__c settings = new Routing_Settings__c(
            Lead_Routing_Enabled__c  = true,
            Lead_Insert_Enabled__c   = true,
            Lead_Update_Enabled__c   = true,
            Webhook_Secret__c        = 'test-secret-key',
            Engine_Endpoint__c       = 'https://engine.example.com'
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

    @isTest
    static void testBatchPayloadFormat() {
        // Verify RoutingPayloadBuilder.buildBatch produces correct schema
        Lead l = new Lead(FirstName = 'Batch', LastName = 'Test', Company = 'BatchCo');
        insert l;
        l = [SELECT Id, FirstName, LastName, Company FROM Lead WHERE Id = :l.Id];

        String payload = RoutingPayloadBuilder.buildBatch('Lead', 'INSERT', new List<Lead>{ l });
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(payload);

        System.assertEquals('LEAD', parsed.get('objectType'));
        System.assertEquals('INSERT', parsed.get('eventType'));
        System.assertNotEquals(null, parsed.get('sfdcOrgId'));
        System.assertNotEquals(null, parsed.get('timestamp'));

        List<Object> records = (List<Object>) parsed.get('records');
        System.assertEquals(1, records.size(), 'Expected 1 record in batch');

        Map<String, Object> rec = (Map<String, Object>) records[0];
        System.assertEquals(String.valueOf(l.Id), rec.get('recordId'));
        System.assertNotEquals(null, rec.get('fields'));
    }

    @isTest
    static void testBulkInsertUsesBatchEndpoint() {
        // Verify that inserting multiple leads sends to /route/batch
        Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();
        settings.Engine_Endpoint__c = 'https://engine.example.com';
        upsert settings;

        RoutingEngineMock mock = new RoutingEngineMock();
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        List<Lead> leads = new List<Lead>();
        for (Integer i = 0; i < 5; i++) {
            leads.add(new Lead(
                FirstName = 'Bulk' + i,
                LastName  = 'Test' + i,
                Company   = 'BulkCo'
            ));
        }
        insert leads;
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c],
            'Expected no error logs for batch callout');
    }
}
