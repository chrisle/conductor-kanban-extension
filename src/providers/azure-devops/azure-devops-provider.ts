import type { Provider } from '../provider'
import { providerRegistry } from '../provider'
import type {
  ProviderConnection, AzureDevOpsConnection, Ticket, Epic, Project,
  PullRequest, CreateTicketParams, UpdateTicketParams,
} from '../../types'
import {
  orgUrl, azureGet, azurePost, azurePatch, azureDelete,
  mapAzureStatus, mapAzurePriority,
} from './azure-devops-api'

function asAzure(connection: ProviderConnection): AzureDevOpsConnection {
  if (connection.providerType !== 'azure-devops') throw new Error('Expected Azure DevOps connection')
  return connection as AzureDevOpsConnection
}

const API_VERSION = 'api-version=7.1'

// ── Azure DevOps response shapes ───────────────────────────────────────────

interface AzureProject {
  id: string
  name: string
  description: string
  state: string
}

interface AzureWorkItemRef {
  id: number
  url: string
}

interface AzureWorkItemFields {
  'System.Id': number
  'System.Title': string
  'System.Description'?: string
  'System.State': string
  'System.WorkItemType': string
  'Microsoft.VSTS.Common.Priority'?: number
  'Microsoft.VSTS.Scheduling.StoryPoints'?: number
  'System.ChangedDate': string
  'System.AreaPath'?: string
  'System.IterationPath'?: string
}

interface AzureWorkItemRelation {
  rel: string
  url: string
  attributes: { name?: string }
}

interface AzureWorkItem {
  id: number
  fields: AzureWorkItemFields
  relations?: AzureWorkItemRelation[]
  url: string
}

interface AzurePullRequest {
  pullRequestId: number
  title: string
  status: string
  repository: { name: string; webUrl: string }
}

class AzureDevOpsProvider implements Provider {
  type = 'azure-devops' as const
  displayName = 'Azure DevOps'
  supportsDelete = true

  async testConnection(connection: ProviderConnection): Promise<void> {
    const conn = asAzure(connection)
    await azureGet(conn, `${orgUrl(conn)}/_apis/projects?$top=1&${API_VERSION}`)
  }

  async fetchProjects(connection: ProviderConnection): Promise<Project[]> {
    const conn = asAzure(connection)
    const data = await azureGet(conn,
      `${orgUrl(conn)}/_apis/projects?$top=100&${API_VERSION}`
    ) as { value: AzureProject[] }

    return data.value
      .filter(p => p.state === 'wellFormed')
      .map(p => ({
        id: p.id,
        key: p.name,
        name: p.name,
        category: 'software',
      }))
  }

  projectBoardUrl(connection: ProviderConnection, project: Project): string {
    const conn = asAzure(connection)
    return `${orgUrl(conn)}/${encodeURIComponent(project.key)}/_boards`
  }

  async fetchTickets(connection: ProviderConnection, projectKey: string): Promise<Ticket[]> {
    const conn = asAzure(connection)
    const base = orgUrl(conn)

    // Query non-Epic, non-removed work items via WIQL
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${projectKey}' AND [System.WorkItemType] <> 'Epic' AND [System.State] <> 'Removed' ORDER BY [System.Id] ASC`

    const queryResult = await azurePost(conn,
      `${base}/${encodeURIComponent(projectKey)}/_apis/wit/wiql?${API_VERSION}`,
      { query: wiql },
    ) as { workItems: AzureWorkItemRef[] }

    if (!queryResult.workItems?.length) return []

    // Fetch work items in batches of 200
    const tickets: Ticket[] = []
    const ids = queryResult.workItems.map(wi => wi.id)

    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200)
      const items = await azureGet(conn,
        `${base}/${encodeURIComponent(projectKey)}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=relations&${API_VERSION}`
      ) as { value: AzureWorkItem[] }

      for (const item of items.value) {
        const f = item.fields
        const parentRel = item.relations?.find(r => r.rel === 'System.LinkTypes.Hierarchy-Reverse')
        const parentId = parentRel ? extractWorkItemId(parentRel.url) : null

        tickets.push({
          key: `${projectKey}#${f['System.Id']}`,
          summary: f['System.Title'],
          description: htmlToText(f['System.Description']),
          status: mapAzureStatus(f['System.State']),
          providerStatus: f['System.State'],
          issueType: f['System.WorkItemType'],
          priority: mapAzurePriority(f['Microsoft.VSTS.Common.Priority']),
          storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] != null
            ? Math.round(f['Microsoft.VSTS.Scheduling.StoryPoints'])
            : null,
          epicKey: parentId ? `${projectKey}#${parentId}` : null,
          updatedAt: f['System.ChangedDate'],
          pullRequests: [],
        })
      }
    }

    // Filter out tickets whose epicKey points to a non-Epic parent
    const epicKeys = new Set((await this.fetchEpics(connection, projectKey)).map(e => e.key))
    for (const t of tickets) {
      if (t.epicKey && !epicKeys.has(t.epicKey)) {
        t.epicKey = null
      }
    }

    return tickets
  }

  async fetchEpics(connection: ProviderConnection, projectKey: string): Promise<Epic[]> {
    const conn = asAzure(connection)
    const base = orgUrl(conn)

    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${projectKey}' AND [System.WorkItemType] = 'Epic' AND [System.State] <> 'Removed' ORDER BY [System.Id] ASC`

    const queryResult = await azurePost(conn,
      `${base}/${encodeURIComponent(projectKey)}/_apis/wit/wiql?${API_VERSION}`,
      { query: wiql },
    ) as { workItems: AzureWorkItemRef[] }

    if (!queryResult.workItems?.length) return []

    const ids = queryResult.workItems.map(wi => wi.id)
    const items = await azureGet(conn,
      `${base}/${encodeURIComponent(projectKey)}/_apis/wit/workitems?ids=${ids.join(',')}&${API_VERSION}`
    ) as { value: AzureWorkItem[] }

    return items.value.map(item => ({
      key: `${projectKey}#${item.fields['System.Id']}`,
      summary: item.fields['System.Title'],
      status: item.fields['System.State'],
    }))
  }

  async fetchDevelopmentInfo(connection: ProviderConnection, issueKey: string): Promise<PullRequest[]> {
    const conn = asAzure(connection)
    const base = orgUrl(conn)
    const { project } = parseIssueKey(issueKey)

    try {
      // Search for PRs mentioning this work item across all repos in the project
      const data = await azureGet(conn,
        `${base}/${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.status=all&$top=100&${API_VERSION}`
      ) as { value: AzurePullRequest[] }

      const workItemId = parseIssueKey(issueKey).id
      const pattern = new RegExp(`#${workItemId}\\b`)

      // Also check artifact links on the work item itself
      const linkedPRs: PullRequest[] = []
      try {
        const item = await azureGet(conn,
          `${base}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemId}?$expand=relations&${API_VERSION}`
        ) as AzureWorkItem
        for (const rel of item.relations ?? []) {
          if (rel.rel === 'ArtifactLink' && rel.url.includes('PullRequestId')) {
            const prIdMatch = rel.url.match(/%2F(\d+)$/) || rel.url.match(/\/(\d+)$/)
            if (prIdMatch) {
              const pr = data.value.find(p => p.pullRequestId === parseInt(prIdMatch[1], 10))
              if (pr) {
                const status = pr.status === 'completed' ? 'MERGED'
                  : pr.status === 'active' ? 'OPEN'
                  : 'CLOSED'
                if (status === 'OPEN' || status === 'MERGED') {
                  linkedPRs.push({
                    id: String(pr.pullRequestId),
                    url: `${base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`,
                    name: pr.title,
                    status,
                  })
                }
              }
            }
          }
        }
      } catch { /* work item relation lookup is best-effort */ }

      // Also match PRs by title/description mentioning the work item ID
      for (const pr of data.value) {
        if (pattern.test(pr.title)) {
          const status = pr.status === 'completed' ? 'MERGED'
            : pr.status === 'active' ? 'OPEN'
            : 'CLOSED'
          if (status === 'OPEN' || status === 'MERGED') {
            linkedPRs.push({
              id: String(pr.pullRequestId),
              url: `${base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`,
              name: pr.title,
              status,
            })
          }
        }
      }

      // Deduplicate by ID
      const prMap = new Map<string, PullRequest>()
      for (const pr of linkedPRs) prMap.set(pr.id, pr)
      return Array.from(prMap.values())
    } catch {
      return []
    }
  }

  async createTicket(connection: ProviderConnection, params: CreateTicketParams): Promise<Ticket> {
    const conn = asAzure(connection)
    const base = orgUrl(conn)
    const workItemType = params.issueType || 'Task'

    const patchOps: Array<{ op: string; path: string; value: unknown }> = [
      { op: 'add', path: '/fields/System.Title', value: params.summary },
      { op: 'add', path: '/fields/System.Description', value: params.description },
    ]

    if (params.epicKey) {
      const parentId = parseIssueKey(params.epicKey).id
      patchOps.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `${base}/${encodeURIComponent(params.projectKey)}/_apis/wit/workitems/${parentId}`,
        },
      })
    }

    const result = await azurePatch(conn,
      `${base}/${encodeURIComponent(params.projectKey)}/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?${API_VERSION}`,
      patchOps,
    ) as AzureWorkItem

    const ticket: Ticket = {
      key: `${params.projectKey}#${result.id}`,
      summary: params.summary,
      status: 'backlog',
      providerStatus: result.fields['System.State'],
      issueType: workItemType,
      priority: null,
      storyPoints: null,
      epicKey: params.epicKey ?? null,
      updatedAt: new Date().toISOString(),
      pullRequests: [],
    }

    if (params.status && params.status !== 'backlog') {
      const stateName = params.status === 'in_progress' ? 'Active' : 'Closed'
      try {
        await this.transitionTicket(connection, ticket.key, stateName)
        ticket.status = params.status
        ticket.providerStatus = stateName
      } catch { /* state transition may not be available */ }
    }

    return ticket
  }

  async updateTicket(connection: ProviderConnection, issueKey: string, params: UpdateTicketParams): Promise<void> {
    const conn = asAzure(connection)
    const base = orgUrl(conn)
    const { project, id } = parseIssueKey(issueKey)

    const patchOps: Array<{ op: string; path: string; value: unknown }> = []

    if (params.summary !== undefined) {
      patchOps.push({ op: 'add', path: '/fields/System.Title', value: params.summary })
    }
    if (params.description !== undefined) {
      patchOps.push({ op: 'add', path: '/fields/System.Description', value: params.description })
    }
    if (params.priority !== undefined) {
      const priorityNum = { Critical: 1, High: 2, Medium: 3, Low: 4 }[params.priority]
      if (priorityNum) {
        patchOps.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: priorityNum })
      }
    }

    if (patchOps.length === 0) return

    await azurePatch(conn,
      `${base}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}?${API_VERSION}`,
      patchOps,
    )
  }

  async transitionTicket(connection: ProviderConnection, issueKey: string, targetStatus: string): Promise<void> {
    const conn = asAzure(connection)
    const base = orgUrl(conn)
    const { project, id } = parseIssueKey(issueKey)

    await azurePatch(conn,
      `${base}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}?${API_VERSION}`,
      [{ op: 'add', path: '/fields/System.State', value: targetStatus }],
    )
  }

  async deleteTicket(connection: ProviderConnection, issueKey: string): Promise<void> {
    const conn = asAzure(connection)
    const base = orgUrl(conn)
    const { project, id } = parseIssueKey(issueKey)

    await azureDelete(conn,
      `${base}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}?${API_VERSION}`
    )
  }

  issueUrl(connection: ProviderConnection, key: string): string {
    const conn = asAzure(connection)
    const { project, id } = parseIssueKey(key)
    return `${orgUrl(conn)}/${encodeURIComponent(project)}/_workitems/edit/${id}`
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseIssueKey(key: string): { project: string; id: number } {
  const hashIdx = key.lastIndexOf('#')
  if (hashIdx === -1) throw new Error(`Invalid Azure DevOps issue key: ${key}. Expected "Project#ID"`)
  const project = key.substring(0, hashIdx)
  const id = parseInt(key.substring(hashIdx + 1), 10)
  if (isNaN(id)) throw new Error(`Invalid work item ID in key: ${key}`)
  return { project, id }
}

function extractWorkItemId(url: string): number | null {
  const match = url.match(/\/workItems\/(\d+)$/i) || url.match(/\/(\d+)$/)
  return match ? parseInt(match[1], 10) : null
}

function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim() || undefined
}

providerRegistry.register(new AzureDevOpsProvider())
