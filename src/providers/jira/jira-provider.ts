import type { Provider } from '../provider'
import { providerRegistry } from '../provider'
import type {
  ProviderConnection, JiraConnection, Ticket, Epic, Project,
  PullRequest, CreateTicketParams, UpdateTicketParams, TicketStatus,
} from '../../types'
import {
  baseUrl, jiraGet, jiraPost, jiraPut, jiraDelete,
  mapStatus, adfToText, resolveIssueTypeId, issueIdMap,
} from './jira-api'

function asJira(connection: ProviderConnection): JiraConnection {
  if (connection.providerType !== 'jira') throw new Error('Expected Jira connection')
  return connection as JiraConnection
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

class JiraProvider implements Provider {
  type = 'jira' as const
  displayName = 'Jira'
  supportsDelete = true

  async testConnection(connection: ProviderConnection): Promise<void> {
    const conn = asJira(connection)
    await jiraGet(conn, '/rest/api/3/project/search?maxResults=1')
  }

  async fetchProjects(connection: ProviderConnection): Promise<Project[]> {
    const conn = asJira(connection)
    const data = await jiraGet(conn, '/rest/api/3/project/search?maxResults=100&orderBy=name') as {
      values?: Array<Record<string, unknown>>
    }
    const projects = (data.values || []).map((p) => ({
      id: p.id as string,
      key: p.key as string,
      name: p.name as string,
      category: p.projectTypeKey as string,
      avatarUrl: (p.avatarUrls as Record<string, string>)?.['24x24'],
    }))

    // Fetch board IDs in parallel (stored in metadata for URL generation)
    const withBoards = await Promise.all(
      projects.map(async (p) => {
        try {
          const boardData = await jiraGet(conn,
            `/rest/agile/1.0/board?projectKeyOrId=${p.key}&maxResults=1`
          ) as { values?: Array<{ id: number }> }
          return { ...p, _boardId: boardData.values?.[0]?.id }
        } catch {
          return { ...p, _boardId: undefined }
        }
      })
    )

    // Store board IDs for URL generation
    for (const p of withBoards) {
      if (p._boardId) jiraBoardIds.set(p.key, p._boardId)
    }

    return withBoards.map(({ _boardId, ...p }) => p)
  }

  projectBoardUrl(connection: ProviderConnection, project: Project): string {
    const conn = asJira(connection)
    const base = baseUrl(conn)
    const boardId = jiraBoardIds.get(project.key)
    const boardSuffix = boardId ? `boards/${boardId}` : 'board'
    switch (project.category) {
      case 'service_desk':
        return `${base}/jira/servicedesk/projects/${project.key}/${boardSuffix}`
      case 'business':
        return `${base}/jira/core/projects/${project.key}/${boardSuffix}`
      default:
        return `${base}/jira/software/projects/${project.key}/${boardSuffix}`
    }
  }

  async fetchTickets(connection: ProviderConnection, projectKey: string): Promise<Ticket[]> {
    const conn = asJira(connection)
    const tickets: Ticket[] = []
    let pageToken: string | undefined

    while (true) {
      const params = new URLSearchParams({
        jql: `project=${projectKey} AND issuetype!=Epic AND issuetype not in subtaskIssueTypes() ORDER BY key ASC`,
        fields: 'summary,description,status,issuetype,priority,parent,customfield_10016,updated',
        maxResults: '50',
      })
      if (pageToken) params.set('nextPageToken', pageToken)

      const result = await jiraGet(conn, `/rest/api/3/search/jql?${params}`) as JiraSearchResult

      for (const issue of result.issues) {
        issueIdMap.set(issue.key, issue.id)
        tickets.push({
          key: issue.key,
          summary: issue.fields.summary,
          description: adfToText(issue.fields.description) || undefined,
          status: mapStatus(issue.fields.status.name),
          providerStatus: issue.fields.status.name,
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

  async fetchEpics(connection: ProviderConnection, projectKey: string): Promise<Epic[]> {
    const conn = asJira(connection)
    const result = await jiraGet(conn, `/rest/api/3/search/jql?${new URLSearchParams({
      jql: `project=${projectKey} AND issuetype=Epic ORDER BY key ASC`,
      fields: 'summary,status',
    })}`) as JiraSearchResult

    return result.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
    }))
  }

  async fetchDevelopmentInfo(connection: ProviderConnection, issueKey: string): Promise<PullRequest[]> {
    const conn = asJira(connection)
    const issueId = issueIdMap.get(issueKey)
    if (!issueId) return []

    try {
      const data = await jiraGet(conn,
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

  async createTicket(connection: ProviderConnection, params: CreateTicketParams): Promise<Ticket> {
    const conn = asJira(connection)
    const issueTypeId = await resolveIssueTypeId(conn, params.projectKey, params.issueType)

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
      issuetype: issueTypeId != null ? { id: issueTypeId } : { name: params.issueType || 'Task' },
    }

    if (params.epicKey) {
      fields.parent = { key: params.epicKey }
    }

    const result = await jiraPost(conn, '/rest/api/3/issue', { fields }) as {
      id: string
      key: string
    }

    const ticket: Ticket = {
      key: result.key,
      summary: params.summary,
      status: 'backlog',
      providerStatus: 'Backlog',
      issueType: params.issueType || 'Task',
      priority: null,
      storyPoints: null,
      epicKey: params.epicKey ?? null,
      updatedAt: new Date().toISOString(),
      pullRequests: [],
    }

    if (params.status && params.status !== 'backlog') {
      const statusName = params.status === 'in_progress' ? 'In Progress'
        : params.status === 'done' ? 'Done'
        : 'Backlog'
      try {
        await this.transitionTicket(connection, result.key, statusName)
        ticket.status = params.status
        ticket.providerStatus = statusName
      } catch {
        // Transition may not be available, ticket stays in backlog
      }
    }

    return ticket
  }

  async updateTicket(connection: ProviderConnection, issueKey: string, params: UpdateTicketParams): Promise<void> {
    const conn = asJira(connection)
    const fields: Record<string, unknown> = {}

    if (params.summary !== undefined) {
      fields.summary = params.summary
    }

    if (params.description !== undefined) {
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

    await jiraPut(conn, `/rest/api/3/issue/${issueKey}`, { fields })
  }

  async transitionTicket(connection: ProviderConnection, issueKey: string, targetStatus: string): Promise<void> {
    const conn = asJira(connection)
    const data = await jiraGet(conn, `/rest/api/3/issue/${issueKey}/transitions`) as {
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

    await jiraPost(conn, `/rest/api/3/issue/${issueKey}/transitions`, {
      transition: { id: transition.id },
    })
  }

  async deleteTicket(connection: ProviderConnection, issueKey: string): Promise<void> {
    const conn = asJira(connection)
    await jiraDelete(conn, `/rest/api/3/issue/${issueKey}`)
  }

  issueUrl(connection: ProviderConnection, key: string): string {
    const conn = asJira(connection)
    return `${baseUrl(conn)}/browse/${key}`
  }
}

// Module-level board ID cache for URL generation
const jiraBoardIds = new Map<string, number>()

// Export for use in issue type resolution from other modules
export { fetchIssueTypes } from './jira-api'

providerRegistry.register(new JiraProvider())
