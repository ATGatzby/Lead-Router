# @lead-routing/mcp

Route leads, manage rules, and monitor activity — all from Claude Code.

---

## What is this?

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that connects Claude Code to your deployed Lead Routing instance. Instead of switching to a browser, you manage your entire routing configuration through natural language conversation.

No browser needed. Just tell Claude what you want:

- "Route this CSV of 500 contacts through our rules"
- "Create a rule for Enterprise leads from California"
- "Show me today's routing activity"

The server exposes **52 tools** across routing, rules management, teams management, users, monitoring, analytics, flows, fields, queues, settings, bulk runs, and audit — all backed by your existing Lead Routing engine and web app. Every tool input is validated with Zod schemas before execution.

---

## Prerequisites

- **Lead Routing** deployed and running (engine + web app via Docker Compose)
- **Claude Code** installed
- **Node.js 20+**

---

## Quick Start

### Step 1 — Generate an API Token

Log into your Lead Routing web app, then navigate to:

**Settings > API Tokens > Create Token**

Give it a name (e.g., "Claude Code MCP") and copy the token. It is shown only once.

### Step 2 — Find Your Credentials

You need five values:

| Credential | Where to find it |
|------------|-----------------|
| `ENGINE_URL` | Your engine's public URL (e.g., `https://engine.example.com`) |
| `APP_URL` | Your web app's public URL (e.g., `https://app.example.com`) |
| `API_TOKEN` | The token you just created in Step 1 |
| `WEBHOOK_SECRET` | From your `lead-routing.json` file (generated during `lead-routing init`) |
| `SFDC_ORG_ID` | Your 18-character Salesforce org ID (starts with `00D`) |

### Step 3 — Add to Claude Code

```bash
claude mcp add --transport stdio lead-routing \
  --env ENGINE_URL=https://engine.example.com \
  --env APP_URL=https://app.example.com \
  --env API_TOKEN=lr_your_token_here \
  --env WEBHOOK_SECRET=your_webhook_secret \
  --env SFDC_ORG_ID=00Dxxxxxxxxxxxxxxxxx \
  -- npx -y @lead-routing/mcp
```

### Step 4 — Verify

Open Claude Code and ask:

> "Check the health of my lead routing engine"

If the server is configured correctly, Claude will call the `check_health` tool and report the engine status.

---

## Available Tools (52)

### Rules Management (9 tools)

| Tool | Description |
|------|-------------|
| `list_rules` | List all routing rules, optionally filtered by object type |
| `get_rule` | Get full detail for a specific rule (conditions, branches, assignment) |
| `create_rule` | Create a new routing rule with conditions and team assignment |
| `update_rule` | Update a rule's name, priority, status, conditions, or branches |
| `delete_rule` | Delete a routing rule |
| `clone_rule` | Clone an existing rule with a new name |
| `reorder_rules` | Reorder rule priorities |
| `test_rule` | Test a rule against a sample record without routing |
| `run_scheduled_rule` | Trigger a scheduled rule to run immediately |

### Teams Management (9 tools)

| Tool | Description |
|------|-------------|
| `list_teams` | List all round-robin teams with member counts |
| `create_team` | Create a new team (round-robin or weighted distribution) |
| `update_team` | Update team name, description, or distribution type |
| `delete_team` | Delete a team (blocked if active rules reference it) |
| `add_team_member` | Add a user to a team with optional weight |
| `remove_team_member` | Remove a user from a team |
| `toggle_team_member` | Enable or disable a team member without removing them |
| `update_team_weights` | Update weight distribution for team members |
| `reset_team_pointer` | Reset the round-robin pointer to the beginning |

### Users (7 tools)

| Tool | Description |
|------|-------------|
| `list_users` | List synced Salesforce users, filterable by name or license status |
| `sync_users` | Trigger an on-demand sync of Salesforce users |
| `update_user_license` | License or unlicense a single user |
| `bulk_license_users` | License or unlicense multiple users at once |
| `license_users_by_role` | License all users matching a Salesforce role |
| `license_users_by_profile` | License all users matching a Salesforce profile |
| `get_user_stats` | Get user licensing statistics (total, licensed, by role/profile) |

### Routing (2 tools)

| Tool | Description |
|------|-------------|
| `route_lead` | Route a single lead, contact, or account through your rules |
| `route_batch` | Route multiple records from JSON or CSV in batches of 200 |

### Monitoring (8 tools)

| Tool | Description |
|------|-------------|
| `check_health` | Check if the routing engine is running and responsive |
| `get_routing_logs` | View recent routing activity with filters for object type and status |
| `get_record_journey` | Trace the full routing history and decision path for a specific record |
| `get_routing_stats` | Get routing statistics and metrics (volume, latency, top rules) |
| `get_failed_logs` | Get failed routing log entries with error details |
| `retry_routing` | Retry a specific failed routing log entry |
| `retry_all_failed` | Retry all failed routing log entries |
| `dismiss_log` | Dismiss/acknowledge a routing log entry |

### Analytics (3 tools)

| Tool | Description |
|------|-------------|
| `get_analytics_overview` | Get analytics dashboard overview (volume, success rate, trends) |
| `get_analytics_rules` | Get per-rule analytics (match rate, volume, latency) |
| `get_analytics_teams` | Get per-team analytics (assignment volume, distribution balance) |

### Flows (3 tools)

| Tool | Description |
|------|-------------|
| `list_flows` | List all decision tree flows |
| `get_flow` | Get full flow detail with decision tree nodes and edges |
| `test_flow` | Test a flow against a sample record to see the path taken |

### Fields (2 tools)

| Tool | Description |
|------|-------------|
| `list_fields` | List synced Salesforce fields, optionally filtered by object type |
| `sync_fields` | Trigger on-demand Salesforce field sync |

### Queues (2 tools)

| Tool | Description |
|------|-------------|
| `list_queues` | List synced Salesforce queues |
| `sync_queues` | Trigger on-demand Salesforce queue sync |

### Settings (4 tools)

| Tool | Description |
|------|-------------|
| `get_routing_mode` | Get current routing mode (live vs dry-run) |
| `set_routing_mode` | Set routing mode to live or dry-run |
| `get_sfdc_status` | Get Salesforce connection status and last sync time |
| `get_license_info` | Get license/subscription information (plan, usage, limits) |

### Bulk Runs (2 tools)

| Tool | Description |
|------|-------------|
| `get_bulk_run_status` | Get status of a bulk routing run (progress, counts) |
| `cancel_bulk_run` | Cancel an in-progress bulk routing run |

### Audit (1 tool)

| Tool | Description |
|------|-------------|
| `get_audit_logs` | Get system audit log entries (actions, users, timestamps) |

---

## Usage Examples

### Discover your setup

- "Show me my routing rules"
- "Who's on the Enterprise team?"
- "List all licensed users"
- "Is our routing engine healthy?"
- "What Salesforce fields are synced for Leads?"
- "Show me our Salesforce queues"

### Create and manage rules

- "Create a rule that routes Enterprise leads from California to the West Coast team"
- "Pause the inbound lead rule"
- "Change the EMEA rule priority to 1"
- "Show me the full config for the APAC rule"
- "Clone the APAC rule and name it EMEA"
- "Reorder rules so Enterprise is first"
- "Test the APAC rule against a sample lead from Japan"
- "Delete the old Q1 test rule"

### Manage teams

- "Create a round-robin team called APAC"
- "Create a weighted team called Enterprise with 60/40 split"
- "Add Sarah and Mike to the Enterprise team"
- "Remove John from the West Coast team"
- "Disable Sarah on the Enterprise team temporarily"
- "Update weights: Sarah 60%, Mike 40%"
- "Reset the round-robin pointer for the West Coast team"
- "Delete the old SDR team"

### Users and licensing

- "Sync our Salesforce users"
- "License all users with the Sales Rep role"
- "License all users with the Standard User profile"
- "Bulk license these 5 users: [list]"
- "Show me user licensing stats"

### Route leads

- "Route this lead: John Smith, VP Sales at Acme, john@acme.com"
- "Route this CSV of 200 contacts through our rules" (paste CSV into the conversation)
- "Sync our Salesforce users, then route these 50 leads"

### Monitor activity

- "Show me today's routing activity"
- "What happened to lead 00Q1234567890AB?"
- "How many leads were unmatched this week?"
- "Show me routing stats for the last month"
- "Show me all failed routing entries"
- "Retry that failed routing"
- "Retry all failed routings"

### Analytics

- "Show me the analytics overview for this week"
- "Which rules have the highest match rate?"
- "How is load distributed across teams?"

### Flows

- "List all decision tree flows"
- "Show me the Enterprise routing flow"
- "Test the main flow against a sample lead"

### Settings and status

- "What's the current routing mode?"
- "Switch to dry-run mode"
- "Is our Salesforce connection healthy?"
- "Show me our license info"

### Bulk runs and audit

- "Check the status of bulk run abc123"
- "Cancel the in-progress bulk run"
- "Show me the audit log"

---

## Safety: Preview and Confirm

All write operations use a **preview-first** pattern. No changes are made until you explicitly confirm.

1. You ask Claude to make a change (create a rule, route leads, delete a team).
2. Claude calls the tool in **preview mode** and shows you exactly what will happen.
3. You review and say "yes" or "looks good."
4. Claude calls the tool again to execute the action.

For routing, the first call runs in **dry-run mode** — rules are evaluated and assignments are calculated, but nothing is updated in Salesforce. You see exactly which records match which rules and who they would be assigned to before committing.

All tool inputs are validated with **Zod schemas** before execution. Invalid parameters are caught immediately with clear error messages, before any API call is made. Schemas are centralized in `src/utils/validate.ts` and enforced in `src/index.ts`.

Every action is logged locally for audit (see [Audit Log](#audit-log) below).

---

## CSV Routing

To route records from a CSV:

1. **Paste the CSV** content into the conversation, or reference a file that Claude can read.
2. **Tell Claude the object type**: "These are Contacts" or "These are Leads."
3. Claude parses the CSV and routes records in **batches of 200**.
4. Results show how many were routed, unmatched, or duplicated.

### CSV requirements

- **Header row** with field names matching your Salesforce field API names.
- An optional `Id` column with Salesforce record IDs. If missing, synthetic IDs are generated automatically.
- Records with or without Salesforce IDs are both supported.
- **Recommended maximum**: 1,000 records per request (5 batch calls).

### Example

```
Id,FirstName,LastName,Company,State,Industry
00Q000000000001,John,Smith,Acme Inc,CA,Technology
00Q000000000002,Jane,Doe,Globex Corp,NY,Finance
```

> "Route this CSV of leads through our rules"

---

## Audit Log

Every MCP tool call is logged to `~/.lead-routing/mcp.log` as JSON lines. This provides an audit trail independent of your Claude Code conversation history.

### View recent activity

```bash
tail -20 ~/.lead-routing/mcp.log | jq .
```

### Filter by tool

```bash
grep '"tool":"create_rule"' ~/.lead-routing/mcp.log | jq .
```

### Filter by action type

```bash
grep '"action":"execute"' ~/.lead-routing/mcp.log | jq .
```

Logs auto-rotate at 10MB, with the last 3 files kept.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ENGINE_URL` | Yes | Public URL of your routing engine (e.g., `https://engine.example.com`) |
| `APP_URL` | Yes | Public URL of your web app (e.g., `https://app.example.com`) |
| `API_TOKEN` | Yes | Bearer token for web app API access (created in Settings > API Tokens) |
| `WEBHOOK_SECRET` | Yes | HMAC signing secret for engine requests (from `lead-routing.json`) |
| `SFDC_ORG_ID` | Yes | 18-character Salesforce org ID (starts with `00D`) |
| `LOG_DIR` | No | Directory for audit logs (defaults to `~/.lead-routing/`) |

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing required env var: ENGINE_URL` | One or more environment variables not set | Re-run `claude mcp add` with all 5 required env vars |
| `Invalid signature` (401) | HMAC secret mismatch | Verify `WEBHOOK_SECRET` matches the value in your `lead-routing.json` |
| `Unauthenticated` (401) | API token is invalid or revoked | Generate a new token in Settings > API Tokens |
| `Unknown org` (401) | Salesforce org ID not recognized | Verify `SFDC_ORG_ID` matches the org connected in your web app |
| `quota_exceeded` (429) | Monthly routing limit reached | Upgrade your plan or wait for the next billing cycle |
| `ECONNREFUSED` | Engine or web app unreachable | Check that your URLs are correct and services are running (`docker compose ps`) |
| `Tool not found` | MCP server not connected | Run `/mcp` in Claude Code to check server status |

---

## Managing the MCP Server

```bash
claude mcp list                    # See all configured MCP servers
claude mcp remove lead-routing     # Remove the Lead Routing server
```

Inside Claude Code, use the `/mcp` command to check server connection status and see available tools.

---

## Resources

The MCP server exposes two resources that you can reference in conversations for context:

| Resource URI | Description |
|-------------|-------------|
| `@lead-routing://rules` | All active routing rules — names, conditions, and assignment targets |
| `@lead-routing://teams` | All teams with member counts and distribution settings |

Use these to give Claude context about your current setup when asking complex questions:

> "Looking at @lead-routing://rules, which rules would match a lead from California in the Technology industry?"

---

## License

Private package. See the root repository for license terms.
