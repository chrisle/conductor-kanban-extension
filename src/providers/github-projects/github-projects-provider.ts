import type { Provider } from '../provider'
import { providerRegistry } from '../provider'
import type {
  ProviderConnection, GitHubProjectsConnection, Ticket, Epic, Project,
  PullRequest, CreateTicketParams, UpdateTicketParams, TicketStatus,
} from '../../types'
import { githubGraphQL, mapGitHubStatus, parseIssueKey } from './github-projects-api'

function asGitHub(connection: ProviderConnection): GitHubProjectsConnection {
  if (connection.providerType !== 'github-projects') {
    throw new Error('Expected GitHub Projects connection')
  }
  return connection as GitHubProjectsConnection
}

// ── Module-level caches ──────────────────────────────────────────────────────
//
// GitHub's GraphQL API addresses everything by opaque node IDs, while the
// kanban host only hands providers a project key and a ticket key. We therefore
// cache the node IDs and field metadata discovered while listing projects and
// tickets. fetchTickets always runs before any mutation (you must view a board
// to act on its cards), so these caches are warm by the time updateTicket /
// transitionTicket / deleteTicket run — the same approach Jira uses with its
// issueIdMap.

interface SelectOption {
  id: string
  name: string
}

interface ProjectFieldMeta {
  url: string
  title: string
  // The single-select "Status" field — the column a card sits in.
  statusField: { id: string; name: string; options: SelectOption[] } | null
  // An optional single-select "Priority" field.
  priorityField: { id: string; name: string; options: SelectOption[] } | null
}
const projectMetaById = new Map<string, ProjectFieldMeta>()

interface ItemMeta {
  itemId: string    // ProjectV2Item node ID — used for board-level mutations
  contentId: string // Issue or DraftIssue node ID — used for content edits
  isDraft: boolean
  projectId: string
  url: string       // issue URL, or the project URL for draft issues
}
const itemMetaByKey = new Map<string, ItemMeta>()

// ── GraphQL documents ────────────────────────────────────────────────────────

// Fields selected for every ProjectV2 returned by a project listing.
const PROJECT_NODE_FIELDS = `
  id
  title
  number
  url
  closed
  owner {
    __typename
    ... on Organization { login avatarUrl }
    ... on User { login avatarUrl }
  }
`

const VIEWER_PROJECTS_QUERY = `
query($cursor: String) {
  viewer {
    projectsV2(first: 50, after: $cursor) {
      nodes { ${PROJECT_NODE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

const ORG_PROJECTS_QUERY = `
query($login: String!, $cursor: String) {
  organization(login: $login) {
    projectsV2(first: 50, after: $cursor) {
      nodes { ${PROJECT_NODE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

const USER_PROJECTS_QUERY = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    projectsV2(first: 50, after: $cursor) {
      nodes { ${PROJECT_NODE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

// Fetches the project's field definitions plus one page of items. Items wrap
// content that is an Issue, a PullRequest or a DraftIssue.
const PROJECT_ITEMS_QUERY = `
query($projectId: ID!, $cursor: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      title
      url
      fields(first: 50) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name }
          ... on ProjectV2SingleSelectField { id name options { id name } }
        }
      }
      items(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          type
          isArchived
          fieldValues(first: 20) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
          content {
            __typename
            ... on DraftIssue {
              id
              title
              body
              updatedAt
            }
            ... on Issue {
              id
              number
              title
              body
              url
              state
              updatedAt
              repository { nameWithOwner }
            }
          }
        }
      }
    }
  }
}`

const ADD_DRAFT_MUTATION = `
mutation($projectId: ID!, $title: String!, $body: String) {
  addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
    projectItem {
      id
      content {
        ... on DraftIssue { id updatedAt }
      }
    }
  }
}`

// Sets a single-select field value (used for both Status and Priority).
const SET_FIELD_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { singleSelectOptionId: $optionId }
  }) {
    projectV2Item { id }
  }
}`

const DELETE_ITEM_MUTATION = `
mutation($projectId: ID!, $itemId: ID!) {
  deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
    deletedItemId
  }
}`

// "Linked pull requests" — the PRs that will close this issue. Mirrors the
// pull-request list shown in the GitHub issue sidebar.
const DEV_PRS_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
        nodes { url title number state }
      }
    }
  }
}`

class GitHubProjectsProvider implements Provider {
  type = 'github-projects' as const
  displayName = 'GitHub Projects'
  // deleteProjectV2Item removes a card from the board. For drafts that deletes
  // the draft entirely; for real issues the issue itself is left untouched.
  supportsDelete = true

  async testConnection(connection: ProviderConnection): Promise<void> {
    const conn = asGitHub(connection)
    await githubGraphQL(conn, 'query { viewer { login } }')
  }

  async fetchProjects(connection: ProviderConnection): Promise<Project[]> {
    const conn = asGitHub(connection)
    const owner = conn.owner?.trim()
    let rawProjects: any[]

    if (!owner) {
      // No owner configured — list every project the authenticated user owns.
      rawProjects = await collectProjects(
        conn, VIEWER_PROJECTS_QUERY, {}, d => d.viewer?.projectsV2,
      )
    } else {
      // An owner can be either an organization or a user account. GitHub uses
      // separate root fields for each, so try organization first and fall back.
      try {
        rawProjects = await collectProjects(
          conn, ORG_PROJECTS_QUERY, { login: owner }, d => d.organization?.projectsV2,
        )
      } catch {
        try {
          rawProjects = await collectProjects(
            conn, USER_PROJECTS_QUERY, { login: owner }, d => d.user?.projectsV2,
          )
        } catch {
          throw new Error(`No GitHub organization or user named "${owner}" with visible projects.`)
        }
      }
    }

    const projects: Project[] = []
    for (const p of rawProjects) {
      if (p.closed) continue // skip archived/closed project boards
      const existing = projectMetaById.get(p.id)
      projectMetaById.set(p.id, {
        url: p.url,
        title: p.title ?? '',
        statusField: existing?.statusField ?? null,
        priorityField: existing?.priorityField ?? null,
      })
      projects.push({
        id: p.id,
        key: p.id, // node ID — directly usable in node(id:) queries, no lookup
        name: p.title || `Project #${p.number}`,
        avatarUrl: p.owner?.avatarUrl,
      })
    }
    return projects
  }

  projectBoardUrl(_connection: ProviderConnection, project: Project): string {
    return projectMetaById.get(project.id)?.url ?? 'https://github.com'
  }

  async fetchTickets(connection: ProviderConnection, projectKey: string): Promise<Ticket[]> {
    const conn = asGitHub(connection)
    const tickets: Ticket[] = []
    let cursor: string | undefined

    while (true) {
      const data = await githubGraphQL(conn, PROJECT_ITEMS_QUERY, {
        projectId: projectKey,
        cursor,
      })
      const project = data.node
      if (!project?.items) {
        throw new Error('GitHub project not found — it may have been deleted, or the token lacks access to it.')
      }

      // Cache the project's Status/Priority field metadata for later mutations.
      cacheProjectFields(projectKey, project)

      for (const item of project.items.nodes ?? []) {
        if (item.isArchived) continue
        // Only issues and drafts are tickets; pull-request cards are skipped.
        if (item.type !== 'ISSUE' && item.type !== 'DRAFT_ISSUE') continue
        const content = item.content
        if (!content) continue // redacted content the viewer cannot see

        const isDraft = content.__typename === 'DraftIssue'
        const { statusName, priorityName, storyPoints } = readFieldValues(item.fieldValues?.nodes ?? [])

        let key: string
        let url: string
        let issueClosed = false
        if (isDraft) {
          key = item.id
          url = project.url
        } else {
          const repo = content.repository?.nameWithOwner ?? ''
          key = `${repo}#${content.number}`
          url = content.url
          issueClosed = content.state === 'CLOSED'
        }

        // The project Status field is the source of truth for the column. When
        // an item has no status set, fall back to the issue's open/closed state.
        const status: TicketStatus = statusName
          ? mapGitHubStatus(statusName)
          : issueClosed ? 'done' : 'backlog'

        itemMetaByKey.set(key, {
          itemId: item.id,
          contentId: content.id,
          isDraft,
          projectId: projectKey,
          url,
        })

        tickets.push({
          key,
          summary: content.title,
          description: content.body || undefined,
          status,
          providerStatus: statusName ?? (issueClosed ? 'Closed' : 'Open'),
          issueType: isDraft ? 'draft' : 'issue',
          priority: priorityName,
          storyPoints,
          epicKey: null,
          updatedAt: content.updatedAt ?? new Date().toISOString(),
          pullRequests: [],
        })
      }

      if (!project.items.pageInfo?.hasNextPage) break
      cursor = project.items.pageInfo.endCursor
    }

    return tickets
  }

  // GitHub Projects v2 has no epic/parent hierarchy that maps cleanly onto
  // swimlanes, so every ticket renders in the ungrouped lane.
  async fetchEpics(_connection: ProviderConnection, _projectKey: string): Promise<Epic[]> {
    return []
  }

  async fetchDevelopmentInfo(connection: ProviderConnection, issueKey: string): Promise<PullRequest[]> {
    const conn = asGitHub(connection)
    const parsed = parseIssueKey(issueKey)
    if (!parsed) return [] // draft issues have no backing repo and no PRs

    try {
      const data = await githubGraphQL(conn, DEV_PRS_QUERY, {
        owner: parsed.owner,
        name: parsed.repo,
        number: parsed.number,
      })
      const nodes = data.repository?.issue?.closedByPullRequestsReferences?.nodes ?? []
      const prs: PullRequest[] = []
      for (const pr of nodes) {
        if (!pr) continue
        const status = pr.state === 'MERGED' ? 'MERGED' : pr.state === 'OPEN' ? 'OPEN' : 'CLOSED'
        if (status === 'OPEN' || status === 'MERGED') {
          prs.push({ id: String(pr.number), url: pr.url, name: pr.title, status })
        }
      }
      return prs
    } catch {
      // Must not throw — this runs inside a Promise.all in the board loader.
      return []
    }
  }

  async createTicket(connection: ProviderConnection, params: CreateTicketParams): Promise<Ticket> {
    const conn = asGitHub(connection)
    const projectId = params.projectKey

    // Projects span multiple repositories and have no default repo, so new
    // cards are created as draft issues — matching GitHub's own quick-add flow.
    const data = await githubGraphQL(conn, ADD_DRAFT_MUTATION, {
      projectId,
      title: params.summary,
      body: params.description || '',
    })
    const item = data.addProjectV2DraftIssue?.projectItem
    if (!item) throw new Error('GitHub did not return the created draft issue.')

    const key: string = item.id
    itemMetaByKey.set(key, {
      itemId: item.id,
      contentId: item.content?.id ?? item.id,
      isDraft: true,
      projectId,
      url: projectMetaById.get(projectId)?.url ?? 'https://github.com',
    })

    const ticket: Ticket = {
      key,
      summary: params.summary,
      description: params.description || undefined,
      status: 'backlog',
      providerStatus: 'Backlog',
      issueType: 'draft',
      priority: null,
      storyPoints: null,
      epicKey: null,
      updatedAt: item.content?.updatedAt ?? new Date().toISOString(),
      pullRequests: [],
    }

    if (params.status && params.status !== 'backlog') {
      const target = params.status === 'in_progress' ? 'In Progress' : 'Done'
      try {
        await this.transitionTicket(connection, key, target)
        ticket.status = params.status
        ticket.providerStatus = target
      } catch {
        // The project may not have a matching Status option — leave in backlog.
      }
    }

    return ticket
  }

  async updateTicket(connection: ProviderConnection, issueKey: string, params: UpdateTicketParams): Promise<void> {
    const conn = asGitHub(connection)
    const meta = itemMetaByKey.get(issueKey)
    if (!meta) {
      throw new Error(`Ticket ${issueKey} is not loaded — refresh the board and try again.`)
    }

    // Title and body live on the underlying issue/draft content. The mutation
    // is built with only the fields that actually changed so that unspecified
    // fields are never blanked out.
    if (params.summary !== undefined || params.description !== undefined) {
      const decls: string[] = []
      const inputs: string[] = []
      const vars: Record<string, unknown> = {}
      if (params.summary !== undefined) {
        decls.push('$title: String')
        inputs.push('title: $title')
        vars.title = params.summary
      }
      if (params.description !== undefined) {
        decls.push('$body: String')
        inputs.push('body: $body')
        vars.body = params.description
      }

      if (meta.isDraft) {
        vars.draftIssueId = meta.contentId
        const mutation = `mutation($draftIssueId: ID!, ${decls.join(', ')}) {
          updateProjectV2DraftIssue(input: { draftIssueId: $draftIssueId, ${inputs.join(', ')} }) {
            draftIssue { id }
          }
        }`
        await githubGraphQL(conn, mutation, vars)
      } else {
        vars.id = meta.contentId
        const mutation = `mutation($id: ID!, ${decls.join(', ')}) {
          updateIssue(input: { id: $id, ${inputs.join(', ')} }) {
            issue { id }
          }
        }`
        await githubGraphQL(conn, mutation, vars)
      }
    }

    // Priority maps to a project-level single-select field when one exists.
    if (params.priority) {
      await setPriority(conn, meta, params.priority)
    }
  }

  async transitionTicket(connection: ProviderConnection, issueKey: string, targetStatus: string): Promise<void> {
    const conn = asGitHub(connection)
    const meta = itemMetaByKey.get(issueKey)
    if (!meta) {
      throw new Error(`Ticket ${issueKey} is not loaded — refresh the board and try again.`)
    }

    const statusField = projectMetaById.get(meta.projectId)?.statusField
    if (!statusField) {
      throw new Error('This GitHub project has no "Status" field, so cards cannot be moved between columns.')
    }

    const option = pickStatusOption(statusField.options, targetStatus)
    if (!option) {
      const names = statusField.options.map(o => o.name).join(', ')
      throw new Error(`No status option matching "${targetStatus}" in this project. Available: ${names}`)
    }

    await githubGraphQL(conn, SET_FIELD_MUTATION, {
      projectId: meta.projectId,
      itemId: meta.itemId,
      fieldId: statusField.id,
      optionId: option.id,
    })
  }

  async deleteTicket(connection: ProviderConnection, issueKey: string): Promise<void> {
    const conn = asGitHub(connection)
    const meta = itemMetaByKey.get(issueKey)
    if (!meta) {
      throw new Error(`Ticket ${issueKey} is not loaded — refresh the board and try again.`)
    }
    await githubGraphQL(conn, DELETE_ITEM_MUTATION, {
      projectId: meta.projectId,
      itemId: meta.itemId,
    })
    itemMetaByKey.delete(issueKey)
  }

  issueUrl(_connection: ProviderConnection, key: string): string {
    const parsed = parseIssueKey(key)
    if (parsed) return `https://github.com/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`
    // Draft issue — fall back to the project board URL.
    return itemMetaByKey.get(key)?.url ?? 'https://github.com'
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Page through a *_PROJECTS_QUERY, returning every ProjectV2 node. */
async function collectProjects(
  conn: GitHubProjectsConnection,
  query: string,
  baseVars: Record<string, unknown>,
  pick: (data: any) => { nodes: any[]; pageInfo: { hasNextPage: boolean; endCursor: string } } | null | undefined,
): Promise<any[]> {
  const all: any[] = []
  let cursor: string | undefined
  while (true) {
    const data = await githubGraphQL(conn, query, { ...baseVars, cursor })
    const connection = pick(data)
    if (!connection) throw new Error('Project owner not found')
    all.push(...(connection.nodes ?? []))
    if (!connection.pageInfo?.hasNextPage) break
    cursor = connection.pageInfo.endCursor
  }
  return all
}

/** Record a project's Status and Priority field definitions for mutations. */
function cacheProjectFields(projectId: string, project: any): void {
  let statusField: ProjectFieldMeta['statusField'] = null
  let priorityField: ProjectFieldMeta['priorityField'] = null
  for (const f of project.fields?.nodes ?? []) {
    if (!f?.name || !f?.id) continue
    const options: SelectOption[] | null = Array.isArray(f.options)
      ? f.options.map((o: any) => ({ id: o.id, name: o.name }))
      : null
    const lower = f.name.toLowerCase()
    if (lower === 'status' && options) {
      statusField = { id: f.id, name: f.name, options }
    } else if (lower === 'priority' && options) {
      priorityField = { id: f.id, name: f.name, options }
    }
  }
  const existing = projectMetaById.get(projectId)
  projectMetaById.set(projectId, {
    url: project.url ?? existing?.url ?? 'https://github.com',
    title: project.title ?? existing?.title ?? '',
    statusField,
    priorityField,
  })
}

/** Pull the Status, Priority and story-point values out of an item's fields. */
function readFieldValues(nodes: any[]): {
  statusName: string | null
  priorityName: string | null
  storyPoints: number | null
} {
  let statusName: string | null = null
  let priorityName: string | null = null
  let storyPoints: number | null = null
  for (const fv of nodes) {
    const fieldName: string = (fv?.field?.name ?? '').toLowerCase()
    if (fv.__typename === 'ProjectV2ItemFieldSingleSelectValue') {
      if (fieldName === 'status') statusName = fv.name ?? null
      else if (fieldName === 'priority') priorityName = fv.name ?? null
    } else if (fv.__typename === 'ProjectV2ItemFieldNumberValue') {
      if (/story point|estimate|points|size/.test(fieldName)) {
        storyPoints = typeof fv.number === 'number' ? Math.round(fv.number) : null
      }
    }
  }
  return { statusName, priorityName, storyPoints }
}

/** Set the Priority single-select field, when the project defines one. */
async function setPriority(conn: GitHubProjectsConnection, meta: ItemMeta, priority: string): Promise<void> {
  const priorityField = projectMetaById.get(meta.projectId)?.priorityField
  if (!priorityField) return // project has no Priority field — nothing to set
  const want = priority.toLowerCase()
  const option =
    priorityField.options.find(o => o.name.toLowerCase() === want) ||
    priorityField.options.find(o => o.name.toLowerCase().includes(want))
  if (!option) return
  await githubGraphQL(conn, SET_FIELD_MUTATION, {
    projectId: meta.projectId,
    itemId: meta.itemId,
    fieldId: priorityField.id,
    optionId: option.id,
  })
}

/**
 * Resolve the host's transition target onto one of the project's Status
 * options. Tries an exact (case-insensitive) name match first — which handles
 * literal GitHub option names like "In Progress" — then falls back to matching
 * by kanban category, so 'backlog' / 'in_progress' / 'done' also resolve.
 */
function pickStatusOption(options: SelectOption[], target: string): SelectOption | undefined {
  const exact = options.find(o => o.name.toLowerCase() === target.toLowerCase())
  if (exact) return exact

  const wanted = classifyTarget(target)
  return options.find(o => mapGitHubStatus(o.name) === wanted)
}

function classifyTarget(target: string): TicketStatus {
  const t = target.toLowerCase()
  if (/done|closed|complete|finish/.test(t)) return 'done'
  if (/progress|doing|review|started|active/.test(t)) return 'in_progress'
  return 'backlog'
}

providerRegistry.register(new GitHubProjectsProvider())
