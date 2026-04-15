import type { AzureDevOpsConnection, TicketStatus } from '../../types'

// ── URL helpers ────────────────────────────────────────────────────────────

export function orgUrl(connection: AzureDevOpsConnection): string {
  return connection.orgUrl.replace(/\/+$/, '')
}

export function authHeaders(connection: AzureDevOpsConnection): Record<string, string> {
  return {
    Authorization: 'Basic ' + btoa(`:${connection.pat}`),
    Accept: 'application/json',
  }
}

// ── Error formatting ───────────────────────────────────────────────────────

export function formatAzureError(status: number, body: unknown, networkError?: string): string {
  const parts = [`Azure DevOps API ${status}`]
  if (body && typeof body === 'object') {
    const b = body as { message?: string; typeKey?: string }
    if (b.message) parts.push(b.message)
    else if (b.typeKey) parts.push(b.typeKey)
  }
  if (networkError) parts.push(networkError)
  return parts.join(' — ')
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

export async function azureGet(connection: AzureDevOpsConnection, url: string): Promise<unknown> {
  const res = await window.electronAPI.httpFetch(url, authHeaders(connection))
  if (!res.ok) throw new Error(formatAzureError(res.status, res.body, res.error))
  return res.body
}

export async function azurePost(connection: AzureDevOpsConnection, url: string, body: unknown): Promise<unknown> {
  const res = await window.electronAPI.httpPost(
    url,
    { ...authHeaders(connection), 'Content-Type': 'application/json' },
    JSON.stringify(body),
  )
  if (!res.ok) throw new Error(formatAzureError(res.status, res.body, res.error))
  return res.body
}

export async function azurePatch(
  connection: AzureDevOpsConnection,
  url: string,
  body: unknown,
  contentType = 'application/json-patch+json',
): Promise<unknown> {
  // Azure DevOps PATCH goes through POST with method override
  const res = await window.electronAPI.httpPost(
    url,
    {
      ...authHeaders(connection),
      'Content-Type': contentType,
      'X-HTTP-Method-Override': 'PATCH',
    },
    JSON.stringify(body),
  )
  if (!res.ok) throw new Error(formatAzureError(res.status, res.body, res.error))
  return res.body
}

export async function azureDelete(connection: AzureDevOpsConnection, url: string): Promise<void> {
  const res = await window.electronAPI.httpDelete(url, authHeaders(connection))
  if (!res.ok) throw new Error(formatAzureError(res.status, res.body, res.error))
}

// ── Status mapping ─────────────────────────────────────────────────────────

const DONE_STATES = new Set(['done', 'closed', 'resolved', 'removed', 'completed'])
const IN_PROGRESS_STATES = new Set(['active', 'in progress', 'committed', 'doing'])

export function mapAzureStatus(state: string): TicketStatus {
  const s = state.toLowerCase()
  if (DONE_STATES.has(s)) return 'done'
  if (IN_PROGRESS_STATES.has(s)) return 'in_progress'
  return 'backlog'
}

// ── Priority mapping ───────────────────────────────────────────────────────

const PRIORITY_MAP: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

export function mapAzurePriority(priority: number | undefined): string | null {
  if (priority == null) return null
  return PRIORITY_MAP[priority] ?? null
}
