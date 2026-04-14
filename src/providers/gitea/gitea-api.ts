import type { GiteaConnection, TicketStatus } from '../../types'

function apiUrl(connection: GiteaConnection): string {
  return connection.baseUrl.replace(/\/+$/, '')
}

function authHeaders(connection: GiteaConnection): Record<string, string> {
  return {
    Authorization: `token ${connection.token}`,
    Accept: 'application/json',
  }
}

function formatGiteaError(status: number, body: unknown, networkError?: string): string {
  const parts = [`Gitea API ${status}`]
  if (body && typeof body === 'object') {
    const b = body as { message?: string }
    if (b.message) parts.push(b.message)
  }
  if (networkError) parts.push(networkError)
  return parts.join(' — ')
}

export async function giteaGet(connection: GiteaConnection, path: string): Promise<unknown> {
  const res = await window.electronAPI.httpFetch(
    `${apiUrl(connection)}/api/v1${path}`,
    authHeaders(connection),
  )
  if (!res.ok) throw new Error(formatGiteaError(res.status, res.body, res.error))
  return res.body
}

export async function giteaPost(connection: GiteaConnection, path: string, body: unknown): Promise<unknown> {
  const res = await window.electronAPI.httpPost(
    `${apiUrl(connection)}/api/v1${path}`,
    { ...authHeaders(connection), 'Content-Type': 'application/json' },
    JSON.stringify(body),
  )
  if (!res.ok) throw new Error(formatGiteaError(res.status, res.body, res.error))
  return res.body
}

export async function giteaPatch(connection: GiteaConnection, path: string, body: unknown): Promise<unknown> {
  // Gitea uses PATCH for updates — route through PUT IPC with method override header
  // Actually, Gitea's PATCH can be sent as a PUT with the right semantics via the proxy
  // But since our proxy only does PUT, we'll use httpPost with a method override
  // For simplicity, route PATCH through the POST handler with a special header
  const res = await window.electronAPI.httpPost(
    `${apiUrl(connection)}/api/v1${path}`,
    {
      ...authHeaders(connection),
      'Content-Type': 'application/json',
      'X-HTTP-Method-Override': 'PATCH',
    },
    JSON.stringify(body),
  )
  if (!res.ok) throw new Error(formatGiteaError(res.status, res.body, res.error))
  return res.body
}

export async function giteaDelete(connection: GiteaConnection, path: string): Promise<void> {
  const res = await window.electronAPI.httpDelete(
    `${apiUrl(connection)}/api/v1${path}`,
    authHeaders(connection),
  )
  if (!res.ok) throw new Error(formatGiteaError(res.status, res.body, res.error))
}

// ── Status mapping ──────────────────────────────────────────────────────────

export function mapGiteaStatus(state: string, labels: Array<{ name: string }>): TicketStatus {
  if (state === 'closed') return 'done'
  const hasInProgress = labels.some(l => /in.?progress|doing|wip/i.test(l.name))
  if (hasInProgress) return 'in_progress'
  return 'backlog'
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function parseProjectKey(projectKey: string): { owner: string; repo: string } {
  const [owner, repo] = projectKey.split('/')
  if (!owner || !repo) throw new Error(`Invalid project key: ${projectKey}. Expected "owner/repo"`)
  return { owner, repo }
}

export function issueNumberFromKey(key: string): number {
  const match = key.match(/#(\d+)$/)
  if (!match) throw new Error(`Invalid issue key: ${key}. Expected "owner/repo#N"`)
  return parseInt(match[1], 10)
}

export function projectKeyFromIssueKey(key: string): string {
  const hashIdx = key.lastIndexOf('#')
  if (hashIdx === -1) throw new Error(`Invalid issue key: ${key}. Expected "owner/repo#N"`)
  return key.substring(0, hashIdx)
}
