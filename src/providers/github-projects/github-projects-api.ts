import type { GitHubProjectsConnection, TicketStatus } from '../../types'

// GitHub Projects v2 is driven entirely by the GraphQL API. There is no REST
// equivalent for reading/writing project boards, so every call in this provider
// goes through the single GraphQL endpoint below.
const GRAPHQL_URL = 'https://api.github.com/graphql'

function authHeaders(connection: GitHubProjectsConnection): Record<string, string> {
  return {
    Authorization: `Bearer ${connection.token}`,
    Accept: 'application/json',
    // GitHub rejects API requests without a User-Agent header.
    'User-Agent': 'Conductor-Kanban-Extension',
  }
}

export function formatGitHubError(status: number, body: unknown, networkError?: string): string {
  const parts = [`GitHub API ${status}`]
  if (body && typeof body === 'object') {
    const b = body as { message?: string; errors?: Array<{ message?: string }> }
    if (b.message) parts.push(b.message)
    if (Array.isArray(b.errors)) {
      const msgs = b.errors.map(e => e?.message).filter(Boolean) as string[]
      if (msgs.length) parts.push(msgs.join('; '))
    }
  }
  if (networkError) parts.push(networkError)
  return parts.join(' — ')
}

interface GraphQLResponse {
  data?: Record<string, any>
  errors?: Array<{ message?: string; type?: string }>
}

/**
 * Execute a GraphQL query or mutation against the GitHub API.
 *
 * GitHub returns HTTP 200 even when the GraphQL document itself fails, so the
 * `errors` array in the response body must be inspected separately from the
 * HTTP status code.
 */
export async function githubGraphQL(
  connection: GitHubProjectsConnection,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const res = await window.electronAPI.httpPost(
    GRAPHQL_URL,
    { ...authHeaders(connection), 'Content-Type': 'application/json' },
    JSON.stringify({ query, variables }),
  )
  if (!res.ok) throw new Error(formatGitHubError(res.status, res.body, res.error))

  const body = res.body as GraphQLResponse
  if (body?.errors?.length) {
    const msg = body.errors.map(e => e.message || e.type || 'unknown error').join('; ')
    throw new Error(`GitHub GraphQL — ${msg}`)
  }
  if (!body?.data) throw new Error('GitHub GraphQL — empty response')
  return body.data
}

// ── Status mapping ──────────────────────────────────────────────────────────

/**
 * Map a GitHub project "Status" column name onto one of the three kanban
 * buckets. GitHub lets users name status columns freely, so we match on common
 * keywords rather than exact strings.
 */
export function mapGitHubStatus(statusName: string | null | undefined): TicketStatus {
  if (!statusName) return 'backlog'
  const s = statusName.toLowerCase()
  if (/\b(done|closed|complete|completed|shipped|released|resolved|cancelled|canceled)\b/.test(s)) {
    return 'done'
  }
  if (/\b(in progress|in review|review|reviewing|doing|started|in development|implementing|qa|testing|verify|validate|active|wip)\b/.test(s)) {
    return 'in_progress'
  }
  return 'backlog'
}

// ── Key parsing ─────────────────────────────────────────────────────────────

/**
 * Real GitHub issues use the human-readable ticket key "owner/repo#number".
 * Draft issues have no backing repository, so their key is the opaque
 * ProjectV2Item node ID instead. Returns null when the key is a draft key.
 */
export function parseIssueKey(key: string): { owner: string; repo: string; number: number } | null {
  const m = key.match(/^([^/\s]+)\/([^/#\s]+)#(\d+)$/)
  if (!m) return null
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) }
}
