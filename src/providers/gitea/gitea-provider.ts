import type { Provider } from '../provider'
import { providerRegistry } from '../provider'
import type {
  ProviderConnection, GiteaConnection, Ticket, Epic, Project,
  PullRequest, CreateTicketParams, UpdateTicketParams,
} from '../../types'
import {
  giteaGet, giteaPost, giteaPatch,
  mapGiteaStatus, parseProjectKey, issueNumberFromKey, projectKeyFromIssueKey,
} from './gitea-api'

function asGitea(connection: ProviderConnection): GiteaConnection {
  if (connection.providerType !== 'gitea') throw new Error('Expected Gitea connection')
  return connection as GiteaConnection
}

interface GiteaRepo {
  id: number
  full_name: string
  name: string
  owner: { login: string; avatar_url: string }
  description: string
  updated_at: string
}

interface GiteaIssue {
  id: number
  number: number
  title: string
  body: string
  state: string
  labels: Array<{ id: number; name: string; color: string }>
  milestone: { id: number; title: string } | null
  updated_at: string
  pull_request: unknown | null
}

interface GiteaMilestone {
  id: number
  title: string
  state: string
}

interface GiteaPullRequest {
  id: number
  number: number
  title: string
  body: string
  state: string
  html_url: string
  merged: boolean
}

class GiteaProvider implements Provider {
  type = 'gitea' as const
  displayName = 'Gitea'
  supportsDelete = false

  async testConnection(connection: ProviderConnection): Promise<void> {
    const conn = asGitea(connection)
    await giteaGet(conn, '/user')
  }

  async fetchProjects(connection: ProviderConnection): Promise<Project[]> {
    const conn = asGitea(connection)
    let repos: GiteaRepo[]

    if (conn.ownerFilter) {
      repos = await giteaGet(conn, `/orgs/${conn.ownerFilter}/repos?limit=50`) as GiteaRepo[]
    } else {
      repos = await giteaGet(conn, '/repos/search?limit=50&sort=updated&order=desc') as GiteaRepo[]
      // repos/search returns { data: [...] } in some Gitea versions
      if (!Array.isArray(repos)) {
        repos = (repos as any).data ?? []
      }
    }

    return repos.map((r) => ({
      id: String(r.id),
      key: r.full_name,
      name: r.name,
      category: 'repository',
      avatarUrl: r.owner?.avatar_url,
    }))
  }

  projectBoardUrl(connection: ProviderConnection, project: Project): string {
    const conn = asGitea(connection)
    const base = conn.baseUrl.replace(/\/+$/, '')
    return `${base}/${project.key}/issues`
  }

  async fetchTickets(connection: ProviderConnection, projectKey: string): Promise<Ticket[]> {
    const conn = asGitea(connection)
    const { owner, repo } = parseProjectKey(projectKey)
    const tickets: Ticket[] = []

    // Fetch open and closed issues
    for (const state of ['open', 'closed'] as const) {
      let page = 1
      while (true) {
        const issues = await giteaGet(conn,
          `/repos/${owner}/${repo}/issues?type=issues&state=${state}&limit=50&page=${page}`
        ) as GiteaIssue[]

        // Filter out pull requests (Gitea sometimes includes them)
        const realIssues = issues.filter(i => !i.pull_request)

        for (const issue of realIssues) {
          tickets.push({
            key: `${projectKey}#${issue.number}`,
            summary: issue.title,
            description: issue.body || undefined,
            status: mapGiteaStatus(issue.state, issue.labels),
            providerStatus: issue.state,
            issueType: 'issue',
            priority: null,
            storyPoints: null,
            epicKey: issue.milestone ? `milestone-${issue.milestone.id}` : null,
            updatedAt: issue.updated_at,
            pullRequests: [],
          })
        }

        if (issues.length < 50) break
        page++
      }
    }

    return tickets
  }

  async fetchEpics(connection: ProviderConnection, projectKey: string): Promise<Epic[]> {
    const conn = asGitea(connection)
    const { owner, repo } = parseProjectKey(projectKey)

    const milestones = await giteaGet(conn,
      `/repos/${owner}/${repo}/milestones?state=all&limit=50`
    ) as GiteaMilestone[]

    return milestones.map((m) => ({
      key: `milestone-${m.id}`,
      summary: m.title,
      status: m.state,
    }))
  }

  async fetchDevelopmentInfo(connection: ProviderConnection, issueKey: string): Promise<PullRequest[]> {
    const conn = asGitea(connection)
    const pk = projectKeyFromIssueKey(issueKey)
    const issueNum = issueNumberFromKey(issueKey)
    const { owner, repo } = parseProjectKey(pk)

    try {
      const pulls = await giteaGet(conn,
        `/repos/${owner}/${repo}/pulls?state=all&limit=50`
      ) as GiteaPullRequest[]

      // Match PRs that reference this issue number
      const pattern = new RegExp(`#${issueNum}\\b`)
      return pulls
        .filter(pr => pattern.test(pr.title) || pattern.test(pr.body || ''))
        .map(pr => ({
          id: String(pr.id),
          url: pr.html_url,
          name: pr.title,
          status: pr.merged ? 'MERGED' : pr.state === 'open' ? 'OPEN' : 'CLOSED',
        }))
        .filter(pr => pr.status === 'OPEN' || pr.status === 'MERGED')
    } catch {
      return []
    }
  }

  async createTicket(connection: ProviderConnection, params: CreateTicketParams): Promise<Ticket> {
    const conn = asGitea(connection)
    const { owner, repo } = parseProjectKey(params.projectKey)

    const body: Record<string, unknown> = {
      title: params.summary,
      body: params.description,
    }

    // Attach to milestone if epicKey is provided
    if (params.epicKey) {
      const milestoneId = params.epicKey.replace('milestone-', '')
      body.milestone = parseInt(milestoneId, 10)
    }

    const issue = await giteaPost(conn, `/repos/${owner}/${repo}/issues`, body) as GiteaIssue

    const ticket: Ticket = {
      key: `${params.projectKey}#${issue.number}`,
      summary: issue.title,
      description: issue.body || undefined,
      status: 'backlog',
      providerStatus: 'open',
      issueType: 'issue',
      priority: null,
      storyPoints: null,
      epicKey: params.epicKey ?? null,
      updatedAt: issue.updated_at,
      pullRequests: [],
    }

    // If we need a non-backlog status, transition it
    if (params.status && params.status !== 'backlog') {
      try {
        await this.transitionTicket(connection, ticket.key, params.status === 'in_progress' ? 'In Progress' : 'Done')
        ticket.status = params.status
      } catch {
        // Label may not exist
      }
    }

    return ticket
  }

  async updateTicket(connection: ProviderConnection, issueKey: string, params: UpdateTicketParams): Promise<void> {
    const conn = asGitea(connection)
    const pk = projectKeyFromIssueKey(issueKey)
    const issueNum = issueNumberFromKey(issueKey)
    const { owner, repo } = parseProjectKey(pk)

    const body: Record<string, unknown> = {}
    if (params.summary !== undefined) body.title = params.summary
    if (params.description !== undefined) body.body = params.description
    // Gitea doesn't have native priority — skip params.priority

    if (Object.keys(body).length === 0) return

    await giteaPatch(conn, `/repos/${owner}/${repo}/issues/${issueNum}`, body)
  }

  async transitionTicket(connection: ProviderConnection, issueKey: string, targetStatus: string): Promise<void> {
    const conn = asGitea(connection)
    const pk = projectKeyFromIssueKey(issueKey)
    const issueNum = issueNumberFromKey(issueKey)
    const { owner, repo } = parseProjectKey(pk)
    const target = targetStatus.toLowerCase()

    if (target === 'done' || target === 'closed') {
      // Close the issue
      await giteaPatch(conn, `/repos/${owner}/${repo}/issues/${issueNum}`, { state: 'closed' })
    } else if (target === 'backlog' || target === 'to do') {
      // Reopen and remove "in progress" label
      await giteaPatch(conn, `/repos/${owner}/${repo}/issues/${issueNum}`, { state: 'open' })
      try {
        await removeLabel(conn, owner, repo, issueNum, /in.?progress|doing|wip/i)
      } catch { /* label may not exist */ }
    } else if (target === 'in progress') {
      // Ensure open and add "in progress" label
      await giteaPatch(conn, `/repos/${owner}/${repo}/issues/${issueNum}`, { state: 'open' })
      try {
        await addLabel(conn, owner, repo, issueNum, 'in progress')
      } catch { /* label may not exist */ }
    }
  }

  async deleteTicket(_connection: ProviderConnection, _issueKey: string): Promise<void> {
    throw new Error('Gitea does not support deleting issues. Close the issue instead.')
  }

  issueUrl(connection: ProviderConnection, key: string): string {
    const conn = asGitea(connection)
    const base = conn.baseUrl.replace(/\/+$/, '')
    const pk = projectKeyFromIssueKey(key)
    const num = issueNumberFromKey(key)
    return `${base}/${pk}/issues/${num}`
  }
}

// ── Label helpers ───────────────────────────────────────────────────────────

async function getRepoLabels(conn: GiteaConnection, owner: string, repo: string): Promise<Array<{ id: number; name: string }>> {
  return await giteaGet(conn, `/repos/${owner}/${repo}/labels?limit=50`) as Array<{ id: number; name: string }>
}

async function addLabel(conn: GiteaConnection, owner: string, repo: string, issueNum: number, labelName: string): Promise<void> {
  const labels = await getRepoLabels(conn, owner, repo)
  const label = labels.find(l => l.name.toLowerCase() === labelName.toLowerCase())
  if (!label) return
  await giteaPost(conn, `/repos/${owner}/${repo}/issues/${issueNum}/labels`, { labels: [label.id] })
}

async function removeLabel(conn: GiteaConnection, owner: string, repo: string, issueNum: number, pattern: RegExp): Promise<void> {
  // Get current issue labels
  const issueLabels = await giteaGet(conn, `/repos/${owner}/${repo}/issues/${issueNum}/labels`) as Array<{ id: number; name: string }>
  for (const label of issueLabels) {
    if (pattern.test(label.name)) {
      try {
        // DELETE /repos/{owner}/{repo}/issues/{index}/labels/{id}
        await window.electronAPI.httpDelete(
          `${conn.baseUrl.replace(/\/+$/, '')}/api/v1/repos/${owner}/${repo}/issues/${issueNum}/labels/${label.id}`,
          { Authorization: `token ${conn.token}`, Accept: 'application/json' },
        )
      } catch { /* best effort */ }
    }
  }
}

providerRegistry.register(new GiteaProvider())
