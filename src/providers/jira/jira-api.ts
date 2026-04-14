import type { JiraConnection } from '../../types'

// ── Shared fetch helper ─────────────────────────────────────────────────────

export function baseUrl(connection: JiraConnection): string {
  const d = connection.domain.replace(/\.atlassian\.net$/, '')
  return `https://${d}.atlassian.net`
}

export function authHeaders(connection: JiraConnection): Record<string, string> {
  return {
    Authorization: 'Basic ' + btoa(`${connection.email}:${connection.apiToken}`),
    Accept: 'application/json',
  }
}

export function formatJiraError(status: number, body: unknown, networkError?: string): string {
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

export async function jiraGet(connection: JiraConnection, path: string): Promise<unknown> {
  const res = await window.electronAPI.httpFetch(
    `${baseUrl(connection)}${path}`,
    authHeaders(connection),
  )
  if (!res.ok) throw new Error(formatJiraError(res.status, res.body, res.error))
  return res.body
}

export async function jiraPost(connection: JiraConnection, path: string, body: unknown): Promise<unknown> {
  const res = await window.electronAPI.httpPost(
    `${baseUrl(connection)}${path}`,
    { ...authHeaders(connection), 'Content-Type': 'application/json' },
    JSON.stringify(body),
  )
  if (!res.ok) throw new Error(formatJiraError(res.status, res.body, res.error))
  return res.body
}

export async function jiraPut(connection: JiraConnection, path: string, body: unknown): Promise<unknown> {
  const res = await window.electronAPI.httpPut(
    `${baseUrl(connection)}${path}`,
    { ...authHeaders(connection), 'Content-Type': 'application/json' },
    JSON.stringify(body),
  )
  if (!res.ok) throw new Error(formatJiraError(res.status, res.body, res.error))
  return res.body
}

export async function jiraDelete(connection: JiraConnection, path: string): Promise<void> {
  const res = await window.electronAPI.httpDelete(
    `${baseUrl(connection)}${path}`,
    authHeaders(connection),
  )
  if (!res.ok) throw new Error(formatJiraError(res.status, res.body, res.error))
}

// ── Status mapping ──────────────────────────────────────────────────────────

import type { TicketStatus } from '../../types'

export function mapStatus(jiraStatus: string): TicketStatus {
  const s = jiraStatus.toLowerCase()
  if (s === 'done' || s === 'closed' || s === 'in review' || s === 'review' || s === 'in qa' || s === 'validate') return 'done'
  if (s === 'in progress' || s === 'in development') return 'in_progress'
  return 'backlog'
}

// ── ADF parser ──────────────────────────────────────────────────────────────

export function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  if (!Array.isArray(n.content)) return ''
  return n.content.map(adfToText).join(n.type === 'paragraph' || n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'heading' ? '\n' : '')
}

// ── Issue types ─────────────────────────────────────────────────────────────

export interface JiraIssueType {
  id: string
  name: string
  subtask: boolean
}

export async function fetchIssueTypes(connection: JiraConnection, projectKey: string): Promise<JiraIssueType[]> {
  const data = await jiraGet(connection, `/rest/api/3/issue/createmeta/${projectKey}/issuetypes`) as {
    issueTypes?: Array<{ id: string; name: string; subtask: boolean }>
    values?: Array<{ id: string; name: string; subtask: boolean }>
  }
  return (data.values || data.issueTypes || []).map((t) => ({
    id: t.id,
    name: t.name,
    subtask: t.subtask,
  }))
}

export async function resolveIssueTypeId(
  connection: JiraConnection,
  projectKey: string,
  requestedName: string | undefined,
): Promise<string | null> {
  let types: JiraIssueType[]
  try {
    types = await fetchIssueTypes(connection, projectKey)
  } catch {
    return null
  }

  const nonSubtask = types.filter((t) => !t.subtask)
  if (!nonSubtask.length) return null

  const name = requestedName || 'Task'
  const exact = nonSubtask.find((t) => t.name.toLowerCase() === name.toLowerCase())
  if (exact) return exact.id

  const fallback =
    nonSubtask.find((t) => /task/i.test(t.name)) ||
    nonSubtask.find((t) => /story/i.test(t.name)) ||
    nonSubtask[0]

  return fallback.id
}

// Store issue IDs for PR lookup
export const issueIdMap = new Map<string, string>()
