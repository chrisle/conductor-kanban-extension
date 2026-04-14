// ── Demo Mode ──────────────────────────────────────────────────────────────

let _demoMode = false

export function isDemoMode(): boolean { return _demoMode }
export function enableDemoMode(): void { _demoMode = true }
export function disableDemoMode(): void { _demoMode = false }

export const DEMO_PROJECT_KEY = 'SD'
export const DEMO_PROJECT_NAME = 'S3 DEMO'

// ── Config ──────────────────────────────────────────────────────────────────

import { useConfigStore } from '@conductor/extension-api'

interface JiraConnection {
  id: string
  name: string
  domain: string
  email: string
  apiToken: string
}

export interface JiraConfig {
  domain: string   // e.g. "triodeofficial" for triodeofficial.atlassian.net
  email: string
  apiToken: string
}

/** Convert a JiraConnection to the JiraConfig shape used by API functions */
function connectionToConfig(conn: JiraConnection): JiraConfig {
  return { domain: conn.domain, email: conn.email, apiToken: conn.apiToken }
}

export function loadConfig(): JiraConfig | null {
  const conn = useConfigStore.getState().getActiveJiraConnection()
  return conn ? connectionToConfig(conn) : null
}

export function saveConfig(config: JiraConfig): void {
  const store = useConfigStore.getState()
  const existing = store.getActiveJiraConnection()
  if (existing) {
    store.updateJiraConnection(existing.id, {
      domain: config.domain,
      email: config.email,
      apiToken: config.apiToken,
    })
  } else {
    store.addJiraConnection({
      id: 'jira-' + config.domain,
      name: config.domain,
      domain: config.domain,
      email: config.email,
      apiToken: config.apiToken,
    })
  }
}

export function clearConfig(): void {
  const store = useConfigStore.getState()
  const existing = store.getActiveJiraConnection()
  if (existing) {
    store.removeJiraConnection(existing.id)
  }
}

function baseUrl(config: JiraConfig): string {
  const d = config.domain.replace(/\.atlassian\.net$/, '')
  return `https://${d}.atlassian.net`
}

function authHeaders(config: JiraConfig): Record<string, string> {
  return {
    Authorization: 'Basic ' + btoa(`${config.email}:${config.apiToken}`),
    Accept: 'application/json',
  }
}

// ── Shared fetch helper ─────────────────────────────────────────────────────

function formatJiraError(status: number, body: unknown, networkError?: string): string {
  const parts = [`Jira API ${status}`]
  if (body && typeof body === 'object') {
    const b = body as { errorMessages?: string[]; errors?: Record<string, string> }
    if (b.errorMessages?.length) parts.push(b.errorMessages.join('; '))
    if (b.errors) {
      const fieldErrors = Object.entries(b.errors)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
      if (fieldErrors.length) parts.push(fieldErrors.join('; '))
    }
  }
  if (networkError) parts.push(networkError)
  return parts.join(' — ')
}

async function jiraGet(config: JiraConfig, path: string): Promise<unknown> {
  const res = await window.electronAPI.jiraFetch(
    `${baseUrl(config)}${path}`,
    authHeaders(config),
  )
  if (!res.ok) throw new Error(formatJiraError(res.status, res.body, res.error))
  return res.body
}

// ── Projects ────────────────────────────────────────────────────────────────

export interface JiraProject {
  id: string
  key: string
  name: string
  projectTypeKey: string
  avatarUrl?: string
  boardId?: number
}

export async function fetchProjects(config: JiraConfig): Promise<JiraProject[]> {
  const data = await jiraGet(config, '/rest/api/3/project/search?maxResults=100&orderBy=name') as {
    values?: Array<Record<string, unknown>>
  }
  const projects = (data.values || []).map((p) => ({
    id: p.id as string,
    key: p.key as string,
    name: p.name as string,
    projectTypeKey: p.projectTypeKey as string,
    avatarUrl: (p.avatarUrls as Record<string, string>)?.['24x24'],
  }))

  // Fetch board IDs in parallel
  const withBoards = await Promise.all(
    projects.map(async (p) => {
      try {
        const boardData = await jiraGet(config,
          `/rest/agile/1.0/board?projectKeyOrId=${p.key}&maxResults=1`
        ) as { values?: Array<{ id: number }> }
        return { ...p, boardId: boardData.values?.[0]?.id }
      } catch {
        return p
      }
    })
  )

  return withBoards
}

export function projectBoardUrl(config: JiraConfig, project: JiraProject): string {
  const base = baseUrl(config)
  const boardSuffix = project.boardId ? `boards/${project.boardId}` : 'board'
  switch (project.projectTypeKey) {
    case 'service_desk':
      return `${base}/jira/servicedesk/projects/${project.key}/${boardSuffix}`
    case 'business':
      return `${base}/jira/core/projects/${project.key}/${boardSuffix}`
    default:
      return `${base}/jira/software/projects/${project.key}/${boardSuffix}`
  }
}

// ── Issue Types ────────────────────────────────────────────────────────────

export interface JiraIssueType {
  id: string
  name: string
  subtask: boolean
}

export async function fetchIssueTypes(config: JiraConfig, projectKey: string): Promise<JiraIssueType[]> {
  const data = await jiraGet(config, `/rest/api/3/issue/createmeta/${projectKey}/issuetypes`) as {
    issueTypes?: Array<{ id: string; name: string; subtask: boolean }>
    values?: Array<{ id: string; name: string; subtask: boolean }>
  }
  return (data.values || data.issueTypes || []).map((t) => ({
    id: t.id,
    name: t.name,
    subtask: t.subtask,
  }))
}

/**
 * Resolve an issue type name against a project's available types, returning the ID.
 * Returns null if the createmeta endpoint is unavailable (e.g. 404/403) so the
 * caller can fall back to specifying the type by name instead of by ID.
 */
async function resolveIssueTypeId(
  config: JiraConfig,
  projectKey: string,
  requestedName: string | undefined,
): Promise<string | null> {
  let types: JiraIssueType[]
  try {
    types = await fetchIssueTypes(config, projectKey)
  } catch {
    // The createmeta endpoint may not be available for this Jira configuration —
    // fall back to specifying the issue type by name in the create request.
    return null
  }

  const nonSubtask = types.filter((t) => !t.subtask)
  if (!nonSubtask.length) return null

  // Try exact match (case-insensitive)
  const name = requestedName || 'Task'
  const exact = nonSubtask.find((t) => t.name.toLowerCase() === name.toLowerCase())
  if (exact) return exact.id

  // Fallback: prefer Task-like, then Story, then first available
  const fallback =
    nonSubtask.find((t) => /task/i.test(t.name)) ||
    nonSubtask.find((t) => /story/i.test(t.name)) ||
    nonSubtask[0]

  return fallback.id
}

// ── Tickets & Epics ─────────────────────────────────────────────────────────

export type TicketStatus = 'backlog' | 'in_progress' | 'done'

export interface Epic {
  key: string
  summary: string
  status: string | null
}

export interface PullRequest {
  id: string
  url: string
  name: string
  status: string
}

export interface Ticket {
  key: string
  summary: string
  description?: string
  status: TicketStatus
  jiraStatus: string
  issueType: string
  priority: string | null
  storyPoints: number | null
  epicKey: string | null
  updatedAt: string
  pullRequests: PullRequest[]
  epic?: Epic
}

function mapStatus(jiraStatus: string): TicketStatus {
  const s = jiraStatus.toLowerCase()
  if (s === 'done' || s === 'closed' || s === 'in review' || s === 'review' || s === 'in qa' || s === 'validate') return 'done'
  if (s === 'in progress' || s === 'in development') return 'in_progress'
  return 'backlog'
}

interface JiraSearchResult {
  issues: Array<{
    id: string
    key: string
    fields: {
      summary: string
      description?: unknown
      status: { name: string }
      issuetype: { name: string }
      priority?: { name: string }
      parent?: { key: string }
      customfield_10016?: number
      updated: string
    }
  }>
  nextPageToken?: string
  isLast: boolean
}

/** Extract plain text from an Atlassian Document Format (ADF) node tree. */
function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  if (!Array.isArray(n.content)) return ''
  return n.content.map(adfToText).join(n.type === 'paragraph' || n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'heading' ? '\n' : '')
}

// Store issue IDs for PR lookup
const issueIdMap = new Map<string, string>()

export async function fetchTickets(config: JiraConfig, projectKey: string): Promise<Ticket[]> {
  const tickets: Ticket[] = []
  let pageToken: string | undefined

  while (true) {
    const params = new URLSearchParams({
      jql: `project=${projectKey} AND issuetype!=Epic AND issuetype not in subtaskIssueTypes() ORDER BY key ASC`,
      fields: 'summary,description,status,issuetype,priority,parent,customfield_10016,updated',
      maxResults: '50',
    })
    if (pageToken) params.set('nextPageToken', pageToken)

    const result = await jiraGet(config, `/rest/api/3/search/jql?${params}`) as JiraSearchResult

    for (const issue of result.issues) {
      issueIdMap.set(issue.key, issue.id)
      tickets.push({
        key: issue.key,
        summary: issue.fields.summary,
        description: adfToText(issue.fields.description) || undefined,
        status: mapStatus(issue.fields.status.name),
        jiraStatus: issue.fields.status.name,
        issueType: issue.fields.issuetype.name,
        priority: issue.fields.priority?.name ?? null,
        storyPoints: issue.fields.customfield_10016 != null
          ? Math.round(issue.fields.customfield_10016)
          : null,
        epicKey: issue.fields.parent?.key ?? null,
        updatedAt: issue.fields.updated,
        pullRequests: [],
      })
    }

    if (result.isLast || !result.nextPageToken) break
    pageToken = result.nextPageToken
  }

  return tickets
}

export async function fetchEpics(config: JiraConfig, projectKey: string): Promise<Epic[]> {
  const result = await jiraGet(config, `/rest/api/3/search/jql?${new URLSearchParams({
    jql: `project=${projectKey} AND issuetype=Epic ORDER BY key ASC`,
    fields: 'summary,status',
  })}`) as JiraSearchResult

  return result.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
  }))
}

export async function fetchDevelopmentInfo(config: JiraConfig, issueKey: string): Promise<PullRequest[]> {
  const issueId = issueIdMap.get(issueKey)
  if (!issueId) return []

  try {
    const data = await jiraGet(config,
      `/rest/dev-status/1.0/issue/detail?issueId=${issueId}&applicationType=GitHub&dataType=pullrequest`
    ) as {
      detail?: Array<{ pullRequests?: Array<{ id: string; url: string; name: string; status: string }> }>
    }

    const prMap = new Map<string, PullRequest>()
    for (const detail of data.detail ?? []) {
      for (const pr of detail.pullRequests ?? []) {
        if (pr.status === 'OPEN' || pr.status === 'MERGED') {
          prMap.set(pr.url, { id: pr.id, url: pr.url, name: pr.name, status: pr.status })
        }
      }
    }
    return Array.from(prMap.values())
  } catch {
    return []
  }
}

// ── Transitions ─────────────────────────────────────────────────────────────

async function jiraPost(config: JiraConfig, path: string, body: unknown): Promise<unknown> {
  const res = await window.electronAPI.jiraPost(
    `${baseUrl(config)}${path}`,
    { ...authHeaders(config), 'Content-Type': 'application/json' },
    JSON.stringify(body),
  )
  if (!res.ok) throw new Error(formatJiraError(res.status, res.body, res.error))
  return res.body
}

async function jiraDelete(config: JiraConfig, path: string): Promise<void> {
  const res = await window.electronAPI.jiraDelete(
    `${baseUrl(config)}${path}`,
    authHeaders(config),
  )
  if (!res.ok) throw new Error(formatJiraError(res.status, res.body, res.error))
}

async function jiraPut(config: JiraConfig, path: string, body: unknown): Promise<unknown> {
  const res = await window.electronAPI.jiraPut(
    `${baseUrl(config)}${path}`,
    { ...authHeaders(config), 'Content-Type': 'application/json' },
    JSON.stringify(body),
  )
  if (!res.ok) throw new Error(formatJiraError(res.status, res.body, res.error))
  return res.body
}

export async function transitionTicket(config: JiraConfig, issueKey: string, targetStatus: string): Promise<void> {
  // Get available transitions
  const data = await jiraGet(config, `/rest/api/3/issue/${issueKey}/transitions`) as {
    transitions: Array<{ id: string; name: string; to: { name: string } }>
  }

  const target = targetStatus.toLowerCase()
  const transition = data.transitions.find(
    (t) => t.to.name.toLowerCase() === target || t.name.toLowerCase() === target
  )

  if (!transition) {
    const available = data.transitions.map((t) => `${t.name} → ${t.to.name}`).join(', ')
    throw new Error(`No transition to "${targetStatus}" for ${issueKey}. Available: ${available}`)
  }

  await jiraPost(config, `/rest/api/3/issue/${issueKey}/transitions`, {
    transition: { id: transition.id },
  })
}

// ── Create ticket ────────────────────────────────────────────────────────────

export interface CreateTicketParams {
  projectKey: string
  summary: string
  description: string
  issueType?: string       // defaults to 'Task'
  epicKey?: string | null   // parent epic
  status?: TicketStatus     // desired initial status
}

export async function createJiraTicket(config: JiraConfig, params: CreateTicketParams): Promise<Ticket> {
  const issueTypeId = await resolveIssueTypeId(config, params.projectKey, params.issueType)

  const fields: Record<string, unknown> = {
    project: { key: params.projectKey },
    summary: params.summary,
    description: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: params.description }],
        },
      ],
    },
    // When the createmeta endpoint is unavailable, issueTypeId is null.
    // The Jira REST API also accepts { name } in place of { id }.
    issuetype: issueTypeId != null ? { id: issueTypeId } : { name: params.issueType || 'Task' },
  }

  if (params.epicKey) {
    fields.parent = { key: params.epicKey }
  }

  const result = await jiraPost(config, '/rest/api/3/issue', { fields }) as {
    id: string
    key: string
  }

  const ticket: Ticket = {
    key: result.key,
    summary: params.summary,
    status: 'backlog',
    jiraStatus: 'Backlog',
    issueType: params.issueType || 'Task',
    priority: null,
    storyPoints: null,
    epicKey: params.epicKey ?? null,
    updatedAt: new Date().toISOString(),
    pullRequests: [],
  }

  // If we need a status other than backlog, transition it
  if (params.status && params.status !== 'backlog') {
    const statusName = params.status === 'in_progress' ? 'In Progress'
      : params.status === 'done' ? 'Done'
      : 'Backlog'
    try {
      await transitionTicket(config, result.key, statusName)
      ticket.status = params.status
      ticket.jiraStatus = statusName
    } catch {
      // Transition may not be available, ticket stays in backlog
    }
  }

  return ticket
}

// ── Update ticket ───────────────────────────────────────────────────────────

export interface UpdateTicketParams {
  summary?: string
  description?: string
  priority?: string         // priority name, e.g. "High"
}

/** Update an existing Jira issue's fields (summary, description, priority). */
export async function updateTicket(
  config: JiraConfig,
  issueKey: string,
  params: UpdateTicketParams,
): Promise<void> {
  const fields: Record<string, unknown> = {}

  if (params.summary !== undefined) {
    fields.summary = params.summary
  }

  if (params.description !== undefined) {
    // Atlassian Document Format for description
    fields.description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: params.description }],
        },
      ],
    }
  }

  if (params.priority !== undefined) {
    fields.priority = { name: params.priority }
  }

  if (Object.keys(fields).length === 0) return

  await jiraPut(config, `/rest/api/3/issue/${issueKey}`, { fields })
}

// ── Delete ticket ──────────────────────────────────────────────────────────

export async function deleteTicket(config: JiraConfig, issueKey: string): Promise<void> {
  await jiraDelete(config, `/rest/api/3/issue/${issueKey}`)
}

// ── URLs ────────────────────────────────────────────────────────────────────

export function issueUrl(config: JiraConfig, key: string): string {
  return `${baseUrl(config)}/browse/${key}`
}

// ── Demo data loaders ──────────────────────────────────────────────────────

let _demoBoardCache: { tickets: Ticket[]; epics: Epic[] } | null = null

export async function loadDemoBoardData(): Promise<{ tickets: Ticket[]; epics: Epic[] }> {
  if (_demoBoardCache) return _demoBoardCache
  const home = await window.electronAPI.getHomeDir()
  const res = await window.electronAPI.readFile(`${home}/.conductor/demo-data/demo-board-data.json`)
  if (res.success && res.content) {
    _demoBoardCache = JSON.parse(res.content)
    return _demoBoardCache!
  }
  return { tickets: [], epics: [] }
}

export const DEMO_CONFIG: JiraConfig = {
  domain: 'demo.atlassian.net',
  email: 'demo@example.com',
  apiToken: 'demo',
}
