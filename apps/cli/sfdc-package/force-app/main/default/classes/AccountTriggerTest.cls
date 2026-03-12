@isTest
class AccountTriggerTest {

    @TestSetup
    static void makeData() {
        Routing_Settings__c settings = new Routing_Settings__c(
            Account_Routing_Enabled__c  = true,
            Account_Insert_Enabled__c   = true,
            Account_Update_Enabled__c   = true,
            Webhook_Secret__c           = 'test-secret-key'
        );
        upsert settings;
    }

    @isTest
    static void testAccountInsertFiresCallout() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock());

        Test.startTest();
        Account a = new Account(Name = 'Tata Consultancy');
        insert a;
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c],
            'Expected no error logs for successful callout');
    }

    @isTest
    static void testAccountUpdateFiresCallout() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock());

        Account a = new Account(Name = 'Infosys Ltd');
        insert a;

        Test.startTest();
        a.BillingCity = 'Bengaluru';
        update a;
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Routing_Error_Log__c]);
    }

    @isTest
    static void testPayloadBuilderBuild() {
        // Unit-test the payload builder directly
        Account a = new Account(Name = 'Test Co');
        insert a;
        a = [SELECT Id, Name, BillingCity FROM Account WHERE Id = :a.Id];

        String payload = RoutingPayloadBuilder.build('Account', 'INSERT', a);
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(payload);

        System.assertEquals('ACCOUNT', parsed.get('objectType'));
        System.assertEquals('INSERT',  parsed.get('eventType'));
        System.assertEquals(String.valueOf(a.Id), parsed.get('recordId'));
        System.assertNotEquals(null, parsed.get('fields'));
    }

    @isTest
    static void testPayloadBuilderBuildBatch() {
        // Unit-test the batch payload builder
        List<Account> accts = new List<Account>();
        accts.add(new Account(Name = 'Batch A'));
        accts.add(new Account(Name = 'Batch B'));
        insert accts;
        accts = [SELECT Id, Name FROM Account WHERE Id IN :accts];

        String payload = RoutingPayloadBuilder.buildBatch('Account', 'INSERT', accts);
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(payload);

        System.assertEquals('ACCOUNT', parsed.get('objectType'));
        System.assertEquals('INSERT', parsed.get('eventType'));
        System.assertNotEquals(null, parsed.get('sfdcOrgId'));

        List<Object> records = (List<Object>) parsed.get('records');
        System.assertEquals(2, records.size(), 'Expected 2 records in batch');

        for (Object r : records) {
            Map<String, Object> rec = (Map<String, Object>) r;
            System.assertNotEquals(null, rec.get('recordId'));
            System.assertNotEquals(null, rec.get('fields'));
        }
    }
}
