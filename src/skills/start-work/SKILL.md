---
name: conductor-jira-start-work
description: Work autonomously on a Jira ticket end to end. Fetches ticket details via Atlassian MCP, implements the work, writes tests, and opens a PR. Use when the user says "start work on <ticket>" or invokes /conductor-jira-start-work with a ticket key.
---

# Start Work on Jira Ticket

Work autonomously on a Jira ticket end to end.

## Arguments

This skill is invoked with positional arguments:

```
/conductor-jira-start-work <ticketKey> <projectKey> <domain>
```

- `ticketKey` — the Jira issue key (e.g. SD-19)
- `projectKey` — the Jira project key (e.g. SD)
- `domain` — the Atlassian domain (e.g. triodeofficial.atlassian.net)

## Models

- **Planning phase** (understanding the ticket, designing the approach): use the most capable model available (claude-opus or equivalent).
- **Execution phase** (writing code, running tests, committing): use the default model.

## Instructions

### Demo Mode

If the domain argument is `demo.atlassian.net` or the `--demo-mode` flag is present, this is a **demo mode** invocation. In demo mode:

1. Do NOT use the Atlassian MCP or make any Jira API calls.
2. Instead, read the ticket details from the file `~/.conductor/demo-data/demo-tickets.json`. This file is a JSON object keyed by ticket key (e.g. `"SD-19"`), where each entry contains `key`, `summary`, `status`, `issueType`, `priority`, `parentKey`, and `description`.
3. Use the `description` field from the demo tickets file as the full ticket specification.
4. Skip attachment downloading (demo tickets have no attachments).
5. Proceed with implementation as normal using the ticket details from the file.

### Normal Mode

1. Use the claude.ai Atlassian MCP (cloud ID 8fd881b3-a07f-4662-bad9-1a9d9e0321a3) to fetch the ticket from the project in the given domain.
2. Download any attachments from the ticket (see below).
3. Work autonomously on this ticket end to end.

## Downloading Attachments

After fetching the ticket, check if it has attachments. If it does, download them using the Jira REST API with credentials from the Conductor config file.

Steps:
1. Read `~/Library/Application Support/conductor/config.json` and extract the `email` and `apiToken` from the first entry in the `jiraConnections` array.
2. Fetch attachment metadata: `curl -s -u "$EMAIL:$API_TOKEN" "https://$DOMAIN/rest/api/3/issue/$TICKET_KEY?fields=attachment"` — parse the `fields.attachment` array from the response.
3. For each attachment, download it to a `.jira-attachments/` directory in the working directory: `curl -s -u "$EMAIL:$API_TOKEN" -o ".jira-attachments/$FILENAME" "$CONTENT_URL"` where `$CONTENT_URL` is the `content` field from each attachment object.
4. Add `.jira-attachments/` to `.gitignore` if it doesn't already contain it.
5. Reference downloaded attachments when implementing the ticket (e.g. design mockups, specs, screenshots).

## Requirements

- Pull latest from main (or dev if main doesn't exist) before starting.
- Write tests for any changes you make. Run the tests and fix them until they pass.
- If you need to test the application, run `make setup-worktree` to install dependencies before running tests.
- Run the full test suite to make sure nothing is broken.
- Only commit changes related to this ticket — keep the PR clean and focused.
- When done, push your branch and open a PR (or update an existing one).
- Update the PR description with a detailed summary of what you did, why, and how to verify.
- Add clear inline comments in the code to explain non-obvious logic.
- Any time you create or update the PR, also add a comment to the Jira ticket summarizing what changed and linking to the PR.
