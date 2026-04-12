# Layout-Based Field Sync

## Overview

Field sync now pulls only the fields present on a user's page layout (Salesforce) or visible properties (HubSpot), rather than all createable/updateable fields on the object. This ensures the criteria builder shows exactly the fields users see on their record templates — including formula fields, roll-ups, and other read-only fields.

## Salesforce Implementation

**File:** `packages/sfdc/src/schema.ts`

### Before
- Called `describeSObject` and filtered fields by `createable || updateable`
- This excluded formula fields, auto-number, system fields, roll-up summaries
- Included many fields not on the user's actual page layout

### After
- Calls the **Describe Layouts REST API** (`/services/data/v62.0/sobjects/{Object}/describe/layouts`) in parallel with `describeSObject`
- Extracts field API names from the default page layout's `detailLayoutSections → layoutRows → layoutItems → layoutComponents`
- Only syncs fields that appear on the layout — formula fields, roll-ups, system fields are all included as long as they're on the layout
- **Fallback:** If the layout API call fails, falls back to syncing all fields (no filter)

### Key Function: `getLayoutFieldNames(conn, objectType)`
- Returns a `Set<string>` of field API names from the first (default) layout
- Traverses: `layouts[0].detailLayoutSections[].layoutRows[].layoutItems[].layoutComponents[]`
- Filters components by `type === "Field"` and extracts `value` (the field API name)

### API Details
- **Endpoint:** `GET /services/data/v62.0/sobjects/{ObjectType}/describe/layouts`
- **Auth:** Uses the org's OAuth access token via jsforce `conn.request()`
- **Response structure:**
  ```json
  {
    "layouts": [{
      "detailLayoutSections": [{
        "layoutRows": [{
          "layoutItems": [{
            "layoutComponents": [{
              "type": "Field",
              "value": "Email"
            }]
          }]
        }]
      }]
    }]
  }
  ```

## HubSpot Implementation

**File:** `packages/hubspot/src/sync-fields.ts`

### Before
- Filtered properties by `!prop.hidden && !prop.calculated`
- This excluded all calculated/formula properties

### After
- Filters properties by `!prop.hidden` only
- Calculated (formula) properties are now included in the sync
- Hidden properties (internal HubSpot system props) remain excluded

### Rationale
HubSpot doesn't have "page layouts" like Salesforce. All non-hidden properties are effectively the user's available fields. The `calculated` filter was too aggressive — formula fields are valuable for routing criteria even though they're read-only.

## Impact on UI

The criteria builder (`ConditionBuilder` / `FieldSelect` components) renders fields from the `fieldSchema` table. No UI changes were needed — the sync layer now provides the correct subset of fields, and the UI displays whatever is in the table.

### Data Flow
```
Salesforce Layout API ─┐
                       ├─→ syncFieldSchema() ─→ fieldSchema table ─→ /api/fields ─→ ConditionBuilder
describeSObject ───────┘

HubSpot Properties API ─→ syncHubSpotFields() ─→ fieldSchema table ─→ /api/fields ─→ ConditionBuilder
```

## Files Changed

| File | Change |
|------|--------|
| `packages/sfdc/src/schema.ts` | Added `getLayoutFieldNames()`, changed filter from `createable/updateable` to layout-based |
| `packages/hubspot/src/sync-fields.ts` | Removed `!prop.calculated` filter to include formula fields |
