/**
 * CriteriaEvaluator — pre-callout trigger criteria filtering.
 *
 * Called from RoutingEngineCallout.sendAsync() to filter records BEFORE
 * making the HTTP callout to the engine. Only records that match at least
 * one active rule's trigger criteria are forwarded.
 *
 * Logic mirrors the engine's evaluator.ts:
 *   AND within a condition group
 *   OR  between condition groups (within a rule)
 *   OR  between rules (a record passes if ANY rule's criteria match)
 *
 * No criteria configured → all records pass (backward compatible).
 *
 * Uses WITHOUT SHARING so the query always runs in system context
 * regardless of the record-owner's sharing rules.
 */
public without sharing class CriteriaEvaluator {

    /**
     * Return the subset of records that satisfy at least one active rule's
     * trigger criteria for the given object type and event type.
     *
     * @param records     SObject records already fetched by RoutingEngineCallout
     * @param objectType  'Lead' | 'Contact' | 'Account' (Pascal case from trigger)
     * @param eventType   'INSERT' | 'UPDATE'
     */
    public static List<SObject> filter(
        List<SObject> records,
        String objectType,
        String eventType
    ) {
        if (records == null || records.isEmpty()) return records;

        String objUpper   = objectType.toUpperCase();
        String eventUpper = eventType.toUpperCase();

        // Load all active criteria for this object + event (or BOTH).
        // Wrapped in try-catch: if Route_Criteria__c isn't deployed yet (e.g. after a partial
        // package upgrade) we fail-open and let all records through rather than dropping them.
        List<Route_Criteria__c> allCriteria;
        try {
            allCriteria = [
                SELECT Rule_Id__c, Group_Id__c, Field_Name__c, Operator__c, Value__c
                FROM Route_Criteria__c
                WHERE Object_Type__c  = :objUpper
                  AND (Event_Type__c  = :eventUpper OR Event_Type__c = 'BOTH')
                  AND Is_Active__c    = true
                ORDER BY Rule_Id__c, Group_Id__c, Sort_Order__c
            ];
        } catch (Exception e) {
            // Route_Criteria__c not available — pass all records through
            System.debug('CriteriaEvaluator: failed to query Route_Criteria__c, passing all records. Error: ' + e.getMessage());
            return records;
        }

        // No criteria configured for any rule → send all records (backward compatible)
        if (allCriteria.isEmpty()) return records;

        // Build: ruleId → groupId → [conditions]
        Map<String, Map<String, List<Route_Criteria__c>>> byRuleByGroup =
            new Map<String, Map<String, List<Route_Criteria__c>>>();

        for (Route_Criteria__c c : allCriteria) {
            if (!byRuleByGroup.containsKey(c.Rule_Id__c)) {
                byRuleByGroup.put(c.Rule_Id__c, new Map<String, List<Route_Criteria__c>>());
            }
            Map<String, List<Route_Criteria__c>> byGroup = byRuleByGroup.get(c.Rule_Id__c);
            if (!byGroup.containsKey(c.Group_Id__c)) {
                byGroup.put(c.Group_Id__c, new List<Route_Criteria__c>());
            }
            byGroup.get(c.Group_Id__c).add(c);
        }

        List<SObject> passing = new List<SObject>();
        for (SObject record : records) {
            if (passesAnyCriteria(record, byRuleByGroup)) {
                passing.add(record);
            }
        }
        return passing;
    }

    // ─── Private helpers ───────────────────────────────────────────────────

    /** True if the record matches at least one rule's criteria (OR across rules). */
    private static Boolean passesAnyCriteria(
        SObject record,
        Map<String, Map<String, List<Route_Criteria__c>>> byRuleByGroup
    ) {
        for (Map<String, List<Route_Criteria__c>> byGroup : byRuleByGroup.values()) {
            if (matchesRule(record, byGroup)) return true;
        }
        return false;
    }

    /** True if the record matches at least one group (OR across groups, AND within group). */
    private static Boolean matchesRule(
        SObject record,
        Map<String, List<Route_Criteria__c>> byGroup
    ) {
        for (List<Route_Criteria__c> groupConds : byGroup.values()) {
            if (groupMatchesAll(record, groupConds)) return true;
        }
        return false;
    }

    /** True if ALL conditions in the group pass (AND logic). */
    private static Boolean groupMatchesAll(
        SObject record,
        List<Route_Criteria__c> conditions
    ) {
        for (Route_Criteria__c cond : conditions) {
            if (!evalCondition(record, cond)) return false;
        }
        return true;
    }

    private static Boolean evalCondition(SObject record, Route_Criteria__c cond) {
        Object rawValue;
        try {
            rawValue = record.get(cond.Field_Name__c);
        } catch (SObjectException e) {
            // Field not available on this record type — treat as blank
            rawValue = null;
        }

        String strValue  = rawValue != null ? String.valueOf(rawValue).trim() : null;
        String condValue = cond.Value__c;
        String op        = cond.Operator__c != null ? cond.Operator__c.toLowerCase() : '';

        if (op == 'is_blank')     return String.isBlank(strValue);
        if (op == 'is_not_blank') return !String.isBlank(strValue);
        if (op == 'is_true')      return rawValue == true || strValue == 'true';
        if (op == 'is_false')     return rawValue == false || String.isBlank(strValue) || strValue == 'false';

        if (op == 'equals') {
            if (strValue == null && condValue == null) return true;
            if (strValue == null || condValue == null) return false;
            return strValue.equalsIgnoreCase(condValue);
        }
        if (op == 'not_equals') {
            if (strValue == null && condValue == null) return false;
            if (strValue == null || condValue == null) return true;
            return !strValue.equalsIgnoreCase(condValue);
        }
        if (op == 'contains') {
            if (strValue == null) return false;
            return strValue.toLowerCase().contains(condValue != null ? condValue.toLowerCase() : '');
        }
        if (op == 'not_contains') {
            if (strValue == null) return true;
            return !strValue.toLowerCase().contains(condValue != null ? condValue.toLowerCase() : '');
        }
        if (op == 'starts_with') {
            if (strValue == null) return false;
            return strValue.toLowerCase().startsWith(condValue != null ? condValue.toLowerCase() : '');
        }

        // Numeric comparisons
        if (op == 'gt' || op == 'lt' || op == 'gte' || op == 'lte') {
            try {
                Decimal sv = Decimal.valueOf(strValue);
                Decimal cv = Decimal.valueOf(condValue);
                if (op == 'gt')  return sv >  cv;
                if (op == 'lt')  return sv <  cv;
                if (op == 'gte') return sv >= cv;
                if (op == 'lte') return sv <= cv;
            } catch (Exception e) { return false; }
        }

        // Date comparisons
        if (op == 'before' || op == 'after') {
            try {
                Date dv = Date.valueOf(strValue);
                Date dc = Date.valueOf(condValue);
                if (op == 'before') return dv < dc;
                if (op == 'after')  return dv > dc;
            } catch (Exception e) { return false; }
        }

        // within_last N days
        if (op == 'within_last') {
            try {
                Integer days = Integer.valueOf(condValue);
                Date cutoff  = Date.today().addDays(-days);
                return Date.valueOf(strValue) >= cutoff;
            } catch (Exception e) { return false; }
        }

        // Picklist multi-select: includes / excludes
        if (op == 'includes' || op == 'excludes') {
            if (strValue == null) return op == 'excludes';
            List<String> rawVals   = strValue.split(';');
            List<String> checkVals = condValue != null ? condValue.split(';') : new List<String>();
            for (Integer i = 0; i < rawVals.size();   i++) rawVals[i]   = rawVals[i].trim();
            for (Integer i = 0; i < checkVals.size(); i++) checkVals[i] = checkVals[i].trim();
            if (op == 'includes') {
                if (checkVals.isEmpty()) return false;
                for (String cv : checkVals) {
                    if (!rawVals.contains(cv)) return false;
                }
                return true;
            } else { // excludes
                for (String cv : checkVals) {
                    if (rawVals.contains(cv)) return false;
                }
                return true;
            }
        }

        // Unknown operator → pass through (don't block the record)
        return true;
    }
}
