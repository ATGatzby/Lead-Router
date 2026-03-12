@isTest
class OnboardingControllerTest {

    @TestSetup
    static void makeData() {
        Routing_Settings__c settings = new Routing_Settings__c(
            Lead_Routing_Enabled__c    = true,
            Lead_Insert_Enabled__c     = true,
            Lead_Update_Enabled__c     = true,
            Contact_Routing_Enabled__c = true,
            Contact_Insert_Enabled__c  = true,
            Contact_Update_Enabled__c  = true,
            Account_Routing_Enabled__c = true,
            Account_Insert_Enabled__c  = true,
            Account_Update_Enabled__c  = true,
            Webhook_Secret__c          = 'test-secret-key',
            Engine_Endpoint__c         = 'https://engine.example.com',
            App_Url__c                 = 'https://app.example.com'
        );
        upsert settings;
    }

    // ─── getAppUrl ───────────────────────────────────────────────────────────────

    @isTest
    static void testGetAppUrl() {
        String url = OnboardingController.getAppUrl();
        System.assertEquals('https://app.example.com', url);
    }

    // ─── getOrgId ────────────────────────────────────────────────────────────────

    @isTest
    static void testGetOrgId() {
        String orgId = OnboardingController.getOrgId();
        System.assertEquals(UserInfo.getOrganizationId(), orgId);
    }

    // ─── checkConnectionStatus ───────────────────────────────────────────────────

    @isTest
    static void testCheckConnectionStatusTrue() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(200, '{"connected":true}'));

        Test.startTest();
        Boolean result = OnboardingController.checkConnectionStatus(UserInfo.getOrganizationId());
        Test.stopTest();

        System.assertEquals(true, result);
    }

    @isTest
    static void testCheckConnectionStatusFalse() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(200, '{"connected":false}'));

        Test.startTest();
        Boolean result = OnboardingController.checkConnectionStatus(UserInfo.getOrganizationId());
        Test.stopTest();

        System.assertEquals(false, result);
    }

    @isTest
    static void testCheckConnectionStatusError() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(500, 'error'));

        Test.startTest();
        Boolean result = OnboardingController.checkConnectionStatus(UserInfo.getOrganizationId());
        Test.stopTest();

        System.assertEquals(false, result);
    }

    // ─── saveRoutingSettings ─────────────────────────────────────────────────────

    @isTest
    static void testSaveRoutingSettings() {
        Test.startTest();
        OnboardingController.saveRoutingSettings(
            true, true, false,    // Lead
            false, false, false,  // Contact
            true, true, true      // Account
        );
        Test.stopTest();

        Routing_Settings__c s = Routing_Settings__c.getOrgDefaults();
        System.assertEquals(true, s.Lead_Routing_Enabled__c);
        System.assertEquals(true, s.Lead_Insert_Enabled__c);
        System.assertEquals(false, s.Lead_Update_Enabled__c);
        System.assertEquals(false, s.Contact_Routing_Enabled__c);
        System.assertEquals(true, s.Account_Routing_Enabled__c);
        System.assertEquals(true, s.Account_Insert_Enabled__c);
        System.assertEquals(true, s.Account_Update_Enabled__c);
    }

    // ─── sendTestEvent ───────────────────────────────────────────────────────────

    @isTest
    static void testSendTestEventSuccess() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(200, '{"ok":true}'));

        Test.startTest();
        OnboardingController.sendTestEvent();
        Test.stopTest();
        // No exception = success
    }

    @isTest
    static void testSendTestEventFailure() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(500, 'Internal Server Error'));

        Test.startTest();
        try {
            OnboardingController.sendTestEvent();
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('500') || e.getMessage().contains('Script-thrown'),
                'Expected error message about 500 status');
        }
        Test.stopTest();
    }

    @isTest
    static void testSendTestEventNoEndpoint() {
        Routing_Settings__c s = Routing_Settings__c.getOrgDefaults();
        s.Engine_Endpoint__c = null;
        upsert s;

        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock());

        Test.startTest();
        try {
            OnboardingController.sendTestEvent();
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('endpoint') || e.getMessage().contains('Script-thrown'),
                'Expected error about missing endpoint');
        }
        Test.stopTest();
    }

    // ─── syncFieldSchema ─────────────────────────────────────────────────────────

    @isTest
    static void testSyncFieldSchemaSuccess() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(200, '{"synced":42}'));

        Test.startTest();
        Integer synced = OnboardingController.syncFieldSchema('LEAD');
        Test.stopTest();

        System.assertEquals(42, synced);
    }

    @isTest
    static void testSyncFieldSchemaFailure() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(500, 'Sync error'));

        Test.startTest();
        try {
            OnboardingController.syncFieldSchema('LEAD');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('Sync failed') || e.getMessage().contains('Script-thrown'),
                'Expected sync failure message');
        }
        Test.stopTest();
    }

    // ─── markOnboardingDone ──────────────────────────────────────────────────────

    @isTest
    static void testMarkOnboardingDone() {
        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock(200, '{"ok":true}'));

        Test.startTest();
        OnboardingController.markOnboardingDone();
        Test.stopTest();
        // Best-effort — no assertions needed, just verifying no exception
    }

    // ─── getAppBaseUrl with blank App_Url__c ─────────────────────────────────────

    @isTest
    static void testGetAppBaseUrlBlank() {
        Routing_Settings__c s = Routing_Settings__c.getOrgDefaults();
        s.App_Url__c = null;
        upsert s;

        Test.setMock(HttpCalloutMock.class, new RoutingEngineMock());

        Test.startTest();
        try {
            OnboardingController.checkConnectionStatus(UserInfo.getOrganizationId());
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('App URL') || e.getMessage().contains('Script-thrown'),
                'Expected error about missing App URL');
        }
        Test.stopTest();
    }
}
