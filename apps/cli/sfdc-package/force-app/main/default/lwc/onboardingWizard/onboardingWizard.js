import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getAppUrl          from '@salesforce/apex/OnboardingController.getAppUrl';
import getOrgId           from '@salesforce/apex/OnboardingController.getOrgId';
import saveRoutingSettings from '@salesforce/apex/OnboardingController.saveRoutingSettings';
import checkConnectionStatus from '@salesforce/apex/OnboardingController.checkConnectionStatus';
import sendTestEvent      from '@salesforce/apex/OnboardingController.sendTestEvent';
import syncFieldSchema    from '@salesforce/apex/OnboardingController.syncFieldSchema';
import markOnboardingDone from '@salesforce/apex/OnboardingController.markOnboardingDone';

const POLL_INTERVAL_MS  = 3000;
const POLL_MAX_ATTEMPTS = 40; // 2 minutes

export default class OnboardingWizard extends LightningElement {

    // ─── Init state ───────────────────────────────────────────────────────────

    @track isLoading  = true;
    @track initError  = null;
    _appUrl    = null;
    _sfdcOrgId = null;

    async connectedCallback() {
        try {
            const [appUrl, orgId] = await Promise.all([getAppUrl(), getOrgId()]);
            if (!appUrl) {
                this.initError = 'Lead Router App URL not configured. Run: lead-routing sfdc deploy';
                return;
            }
            this._appUrl    = appUrl;
            this._sfdcOrgId = orgId;
        } catch (e) {
            this.initError = this._errorMsg(e);
        } finally {
            this.isLoading = false;
        }
    }

    // ─── Step state ───────────────────────────────────────────────────────────

    @track currentStep = 1;

    get isStep1() { return this.currentStep === 1; }
    get isStep2() { return this.currentStep === 2; }
    get isStep3() { return this.currentStep === 3; }
    get isStep4() { return this.currentStep === 4; }

    get steps() {
        return [1, 2, 3, 4].map(i => ({
            index: i,
            label: ['Connect Org', 'Activate Objects', 'Sync Fields', 'Done'][i - 1],
            cssClass: [
                'slds-progress__item',
                i < this.currentStep ? 'slds-is-completed' : '',
                i === this.currentStep ? 'slds-is-active' : ''
            ].filter(Boolean).join(' ')
        }));
    }

    get progressPercent() { return Math.round(((this.currentStep - 1) / 3) * 100); }
    get progressStyle() { return `width: ${this.progressPercent}%`; }

    // ─── Step 1: Connection ───────────────────────────────────────────────────

    @track isConnected = false;
    @track isPolling   = false;
    _pollTimer = null;
    _pollCount = 0;

    handleConnect() {
        const authUrl = `${this._appUrl}/api/auth/sfdc/login`;
        window.open(authUrl, '_blank', 'width=600,height=700');
        this.isPolling  = true;
        this._pollCount = 0;
        this._pollTimer = setInterval(() => this._pollConnectionStatus(), POLL_INTERVAL_MS);
    }

    async _pollConnectionStatus() {
        this._pollCount++;
        if (this._pollCount > POLL_MAX_ATTEMPTS) {
            clearInterval(this._pollTimer);
            this.isPolling = false;
            this._showError('Connection timed out. Please try again.');
            return;
        }

        try {
            const status = await checkConnectionStatus({ sfdcOrgId: this._sfdcOrgId });
            if (status === true) {
                clearInterval(this._pollTimer);
                this.isPolling   = false;
                this.isConnected = true;
            }
        } catch (e) {
            // Ignore polling errors — keep retrying
        }
    }

    goToStep2() { this.currentStep = 2; }

    // ─── Step 2: Object / Event settings ─────────────────────────────────────

    @track leadEnabled    = true;
    @track leadInsert     = true;
    @track leadUpdate     = false;
    @track contactEnabled = false;
    @track contactInsert  = false;
    @track contactUpdate  = false;
    @track accountEnabled = false;
    @track accountInsert  = false;
    @track accountUpdate  = false;

    @track isSaving       = false;
    @track step2Message   = '';
    @track step2MessageClass = 'slds-text-align_center slds-m-top_small';

    handleLeadEnabledChange(e)    { this.leadEnabled    = e.detail.checked; }
    handleLeadInsertChange(e)     { this.leadInsert     = e.detail.checked; }
    handleLeadUpdateChange(e)     { this.leadUpdate     = e.detail.checked; }
    handleContactEnabledChange(e) { this.contactEnabled = e.detail.checked; }
    handleContactInsertChange(e)  { this.contactInsert  = e.detail.checked; }
    handleContactUpdateChange(e)  { this.contactUpdate  = e.detail.checked; }
    handleAccountEnabledChange(e) { this.accountEnabled = e.detail.checked; }
    handleAccountInsertChange(e)  { this.accountInsert  = e.detail.checked; }
    handleAccountUpdateChange(e)  { this.accountUpdate  = e.detail.checked; }

    async handleTestEvent() {
        this.isSaving     = true;
        this.step2Message = '';
        try {
            await sendTestEvent();
            this.step2Message      = '✓ Test event sent — check routing history in Lead Router.';
            this.step2MessageClass = 'slds-text-align_center slds-m-top_small slds-text-color_success';
        } catch (e) {
            this.step2Message      = 'Test event failed: ' + this._errorMsg(e);
            this.step2MessageClass = 'slds-text-align_center slds-m-top_small slds-text-color_error';
        } finally {
            this.isSaving = false;
        }
    }

    async handleSaveSettings() {
        this.isSaving = true;
        try {
            await saveRoutingSettings({
                leadEnabled:    this.leadEnabled,
                leadInsert:     this.leadInsert,
                leadUpdate:     this.leadUpdate,
                contactEnabled: this.contactEnabled,
                contactInsert:  this.contactInsert,
                contactUpdate:  this.contactUpdate,
                accountEnabled: this.accountEnabled,
                accountInsert:  this.accountInsert,
                accountUpdate:  this.accountUpdate
            });
            this.currentStep = 3;
        } catch (e) {
            this._showError('Failed to save settings: ' + this._errorMsg(e));
        } finally {
            this.isSaving = false;
        }
    }

    // ─── Step 3: Sync fields ──────────────────────────────────────────────────

    @track isSyncing    = false;
    @track syncResults  = [];

    get allSynced() { return this.syncResults.length > 0; }

    async handleSyncFields() {
        this.isSyncing   = true;
        this.syncResults = [];

        const objects = [];
        if (this.leadEnabled)    objects.push('LEAD');
        if (this.contactEnabled) objects.push('CONTACT');
        if (this.accountEnabled) objects.push('ACCOUNT');

        try {
            for (const obj of objects) {
                // eslint-disable-next-line no-await-in-loop
                const synced = await syncFieldSchema({ objectType: obj });
                this.syncResults = [...this.syncResults, { object: obj, synced }];
            }
        } catch (e) {
            this._showError('Sync failed: ' + this._errorMsg(e));
        } finally {
            this.isSyncing = false;
        }
    }

    goToStep4() { this.currentStep = 4; this._completeOnboarding(); }

    async _completeOnboarding() {
        try {
            await markOnboardingDone();
        } catch (e) {
            // Non-fatal — onboarding flag is cosmetic
        }
    }

    // ─── Step 4: Done ─────────────────────────────────────────────────────────

    handleOpenApp() {
        window.open(this._appUrl, '_blank');
    }

    // ─── Utilities ────────────────────────────────────────────────────────────

    _showError(msg) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Error',
            message: msg,
            variant: 'error'
        }));
    }

    _errorMsg(err) {
        return (err && err.body && err.body.message) ? err.body.message : String(err);
    }
}
