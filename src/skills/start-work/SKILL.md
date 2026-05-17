---
name: conductor-start-work
description: Work autonomously on a ticket end to end. Fetches ticket details, implements the work, writes tests, and opens a PR. Supports Jira, Gitea, and GitHub Projects providers. Use when the user says "start work on <ticket>" or invokes /conductor-start-work with a ticket key.
---

# Start Work on Ticket

Work autonomously on a ticket end to end.

## Arguments

This skill is invoked with positional arguments:

```
/conductor-start-work <ticketKey> <projectKey> <providerType> <domain>
```

- `ticketKey` — the ticket key (e.g. SD-19 for Jira, owner/repo#42 for Gitea and GitHub Projects)
- `projectKey` — the project key (e.g. SD for Jira, owner/repo for Gitea, the project node ID for GitHub Projects)
- `providerType` — the provider type: `jira`, `gitea`, or `github-projects`
- `domain` — the provider domain (e.g. triodeofficial.atlassian.net for Jira, gitea.example.com for Gitea, the org or user for GitHub Projects)

## Models

- **Planning phase** (understanding the ticket, designing the approach): use the most capable model available (claude-opus or equivalent).
- **Execution phase** (writing code, running tests, committing): use the default model.

## Instructions

### Jira Mode (providerType = jira)

1. Use the claude.ai Atlassian MCP (cloud ID 8fd881b3-a07f-4662-bad9-1a9d9e0321a3) to fetch the ticket from the project in the given domain.
2. Download any attachments from the ticket (see below).
3. Work autonomously on this ticket end to end.

### Gitea Mode (providerType = gitea)

1. Read `~/Library/Application Support/conductor/config.json` and extract the Gitea connection matching the domain from the `providerConnections` array (filter by `providerType: 'gitea'`).
2. Use the Gitea REST API to fetch the issue details: `curl -s -H "Authorization: token $TOKEN" "https://$DOMAIN/api/v1/repos/$PROJECT_KEY/issues/$ISSUE_NUMBER"` where `$ISSUE_NUMBER` is extracted from the ticket key (the number after `#`).
3. Work autonomously on this ticket end to end.

### GitHub Projects Mode (providerType = github-projects)

1. Read `~/Library/Application Support/conductor/config.json` and extract the GitHub Projects connection from the `providerConnections` array (filter by `providerType: 'github-projects'`). If a domain was passed, match the connection whose `owner` equals it; otherwise use the first match. Use its `token` for all API calls.
2. Fetch the ticket details:
   - If the ticket key has the form `owner/repo#<number>` it is a real GitHub issue — fetch it with the REST API: `curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$OWNER/$REPO/issues/$NUMBER"`.
   - Otherwise the key is an opaque project-item node ID for a draft issue — fetch its title and body with the GraphQL API: `POST https://api.github.com/graphql` with `query { node(id: "<ticketKey>") { ... on ProjectV2Item { content { ... on DraftIssue { title body } } } } }`.
3. Work autonomously on this ticket end to end.
4. When opening the PR for a real issue, prefix the title with `#<number>:` and reference the issue with a closing keyword (e.g. `Closes #<number>`) so it closes on merge. Draft issues cannot be linked to a PR — just describe the work in the PR description.

## Downloading Attachments (Jira only)

After fetching the ticket, check if it has attachments. If it does, download them using the Jira REST API with credentials from the Conductor config file.

Steps:
1. Read `~/Library/Application Support/conductor/config.json` and extract the `email` and `apiToken` from the first Jira entry in the `providerConnections` array (filter by `providerType: 'jira'`).
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
- Before committing, run these auto-formatters so the CI lint/format checks don't fail:
  - `npx prettier --check "**/*.{ts,tsx,js,mjs,cjs,json,yml,yaml,md}" --write` (matches CI's `prettier --check`)
  - `~/.local/bin/ruff check --fix services/ && ~/.local/bin/ruff format services/` (matches CI's `ruff format --check services/`)
- When done, push your branch and open a PR (or update an existing one).
- Always include the ticket number in the PR. Put the ticket key at the start of the PR title (e.g. `SD-19: Add login redirect` for Jira, `#42: Add login redirect` for Gitea) and reference the ticket in the PR description (for Gitea, use a closing keyword like `Closes #42`). When updating an existing PR, make sure its title and description already include the ticket number — add it if missing.
- Update the PR description with a detailed summary of what you did, why, and how to verify.
- Add clear inline comments in the code to explain non-obvious logic.
- Any time you create or update the PR, also add a comment to the ticket summarizing what changed and linking to the PR.
