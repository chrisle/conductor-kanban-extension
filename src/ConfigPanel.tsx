import React, { useState } from 'react'
import { Trash2, Eye, EyeOff, Plus } from 'lucide-react'
import { useConfigStore, ui } from '@conductor/extension-api'
import type { ProviderConnection, ProviderType, JiraConnection, GiteaConnection } from './types'
import { providerRegistry } from './providers/provider'

const { Button } = ui

const PROVIDER_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: 'jira', label: 'Jira' },
  { value: 'gitea', label: 'Gitea' },
]

type JiraFormState = { domain: string; email: string; apiToken: string }
type GiteaFormState = { baseUrl: string; token: string; ownerFilter: string }

export default function ConfigPanel(): React.ReactElement {
  const connections = useConfigStore((s: any) => s.config.providerConnections) as ProviderConnection[]

  const addConnection = useConfigStore((s: any) => s.addProviderConnection)
  const updateConnection = useConfigStore((s: any) => s.updateProviderConnection)
  const removeConnection = useConfigStore((s: any) => s.removeProviderConnection)

  const [showForm, setShowForm] = useState(false)
  const [providerType, setProviderType] = useState<ProviderType>('jira')
  const [jiraForm, setJiraForm] = useState<JiraFormState>({ domain: '', email: '', apiToken: '' })
  const [giteaForm, setGiteaForm] = useState<GiteaFormState>({ baseUrl: '', token: '', ownerFilter: '' })
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [tokenVisible, setTokenVisible] = useState<Set<string>>(new Set())
  const [newTokenVisible, setNewTokenVisible] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editProviderType, setEditProviderType] = useState<ProviderType>('jira')
  const [editJiraForm, setEditJiraForm] = useState<JiraFormState>({ domain: '', email: '', apiToken: '' })
  const [editGiteaForm, setEditGiteaForm] = useState<GiteaFormState>({ baseUrl: '', token: '', ownerFilter: '' })
  const [editTesting, setEditTesting] = useState(false)
  const [editError, setEditError] = useState('')

  function toggleTokenVisibility(id: string) {
    setTokenVisible(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function buildConnection(): ProviderConnection | null {
    if (providerType === 'jira') {
      const domain = jiraForm.domain.trim()
      const email = jiraForm.email.trim()
      const apiToken = jiraForm.apiToken.trim()
      if (!domain || !email || !apiToken) return null
      return {
        id: 'jira-' + domain,
        name: domain,
        providerType: 'jira',
        domain,
        email,
        apiToken,
      }
    } else {
      const baseUrl = giteaForm.baseUrl.trim().replace(/\/+$/, '')
      const token = giteaForm.token.trim()
      if (!baseUrl || !token) return null
      const ownerFilter = giteaForm.ownerFilter.trim() || undefined
      return {
        id: 'gitea-' + baseUrl.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-'),
        name: baseUrl,
        providerType: 'gitea',
        baseUrl,
        token,
        ownerFilter,
      }
    }
  }

  function buildEditConnection(): ProviderConnection | null {
    if (editProviderType === 'jira') {
      const domain = editJiraForm.domain.trim()
      const email = editJiraForm.email.trim()
      const apiToken = editJiraForm.apiToken.trim()
      if (!domain || !email || !apiToken) return null
      return {
        id: editingId!,
        name: domain,
        providerType: 'jira',
        domain,
        email,
        apiToken,
      }
    } else {
      const baseUrl = editGiteaForm.baseUrl.trim().replace(/\/+$/, '')
      const token = editGiteaForm.token.trim()
      if (!baseUrl || !token) return null
      const ownerFilter = editGiteaForm.ownerFilter.trim() || undefined
      return {
        id: editingId!,
        name: baseUrl,
        providerType: 'gitea',
        baseUrl,
        token,
        ownerFilter,
      }
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const conn = buildConnection()
    if (!conn) {
      setError('All required fields must be filled')
      return
    }
    setTesting(true)
    setError('')
    try {
      const provider = providerRegistry.get(providerType)
      await provider.testConnection(conn)
      await addConnection(conn)
      setJiraForm({ domain: '', email: '', apiToken: '' })
      setGiteaForm({ baseUrl: '', token: '', ownerFilter: '' })
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setTesting(false)
    }
  }

  function startEdit(conn: ProviderConnection) {
    setEditingId(conn.id)
    setEditProviderType(conn.providerType)
    setEditError('')
    if (conn.providerType === 'jira') {
      setEditJiraForm({ domain: conn.domain, email: conn.email, apiToken: conn.apiToken })
    } else {
      setEditGiteaForm({ baseUrl: conn.baseUrl, token: conn.token, ownerFilter: conn.ownerFilter ?? '' })
    }
  }

  async function handleSaveEdit() {
    if (!editingId) return
    const conn = buildEditConnection()
    if (!conn) {
      setEditError('All required fields must be filled')
      return
    }
    setEditTesting(true)
    setEditError('')
    try {
      const provider = providerRegistry.get(editProviderType)
      await provider.testConnection(conn)
      await updateConnection(editingId, conn)
      setEditingId(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setEditTesting(false)
    }
  }

  async function handleRemove(id: string) {
    await removeConnection(id)
    if (editingId === id) setEditingId(null)
  }

  function connectionDisplayName(conn: ProviderConnection): string {
    if (conn.providerType === 'jira') {
      return conn.domain.replace(/\.atlassian\.net$/, '') + '.atlassian.net'
    }
    return conn.baseUrl
  }

  function connectionSubtext(conn: ProviderConnection): string {
    if (conn.providerType === 'jira') return conn.email
    return conn.ownerFilter ? `owner: ${conn.ownerFilter}` : ''
  }

  function connectionToken(conn: ProviderConnection): string {
    if (conn.providerType === 'jira') return conn.apiToken
    return conn.token
  }

  function providerBadgeColor(type: ProviderType): string {
    if (type === 'jira') return 'bg-blue-900/50 text-blue-400'
    return 'bg-orange-900/50 text-orange-400'
  }

  function renderJiraFields(
    form: JiraFormState,
    setForm: React.Dispatch<React.SetStateAction<JiraFormState>>,
    isEdit: boolean,
  ) {
    return (
      <>
        <div className="space-y-1">
          <label className="text-[11px] text-zinc-400 font-medium">Domain</label>
          <input
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
            placeholder="e.g. mycompany"
            value={form.domain}
            onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-zinc-400 font-medium">Email</label>
          <input
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
            placeholder="you@example.com"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-zinc-400 font-medium">API Token</label>
          {isEdit ? (
            <input
              type="password"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
              placeholder="API token"
              value={form.apiToken}
              onChange={e => setForm(f => ({ ...f, apiToken: e.target.value }))}
            />
          ) : (
            <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5">
              <input
                type={newTokenVisible ? 'text' : 'password'}
                className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder-zinc-500"
                placeholder="API token"
                value={form.apiToken}
                onChange={e => setForm(f => ({ ...f, apiToken: e.target.value }))}
              />
              <button
                type="button"
                onClick={() => setNewTokenVisible(v => !v)}
                className="text-zinc-500 hover:text-zinc-300 shrink-0"
              >
                {newTokenVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>
      </>
    )
  }

  function renderGiteaFields(
    form: GiteaFormState,
    setForm: React.Dispatch<React.SetStateAction<GiteaFormState>>,
    isEdit: boolean,
  ) {
    return (
      <>
        <div className="space-y-1">
          <label className="text-[11px] text-zinc-400 font-medium">Base URL</label>
          <input
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
            placeholder="e.g. https://gitea.example.com"
            value={form.baseUrl}
            onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-zinc-400 font-medium">Token</label>
          {isEdit ? (
            <input
              type="password"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
              placeholder="Access token"
              value={form.token}
              onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
            />
          ) : (
            <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5">
              <input
                type={newTokenVisible ? 'text' : 'password'}
                className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder-zinc-500"
                placeholder="Access token"
                value={form.token}
                onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
              />
              <button
                type="button"
                onClick={() => setNewTokenVisible(v => !v)}
                className="text-zinc-500 hover:text-zinc-300 shrink-0"
              >
                {newTokenVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-zinc-400 font-medium">Owner Filter <span className="text-zinc-600">(optional)</span></label>
          <input
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
            placeholder="e.g. my-org"
            value={form.ownerFilter}
            onChange={e => setForm(f => ({ ...f, ownerFilter: e.target.value }))}
          />
        </div>
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-ui-sm text-zinc-500 uppercase tracking-wider font-medium">
        Provider Connections
      </div>
      <div className="text-ui-sm text-zinc-500">
        Manage your provider connections. The first connection is used as the active connection.
      </div>

      {/* Existing connections */}
      {connections.map(conn => (
        <div key={conn.id} className="border border-zinc-700 rounded-md p-3 space-y-2">
          {editingId === conn.id ? (
            <>
              <div className="space-y-2">
                {editProviderType === 'jira'
                  ? renderJiraFields(editJiraForm, setEditJiraForm, true)
                  : renderGiteaFields(editGiteaForm, setEditGiteaForm, true)}
                {editError && <div className="text-[11px] text-red-400">{editError}</div>}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditingId(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={editTesting}
                  className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-3 py-1 transition-colors"
                >
                  {editTesting ? 'Testing...' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${providerBadgeColor(conn.providerType)}`}>
                    {conn.providerType}
                  </span>
                  <span className="text-xs text-zinc-200 font-medium">
                    {connectionDisplayName(conn)}
                  </span>
                </div>
                {connectionSubtext(conn) && (
                  <div className="text-[11px] text-zinc-500 truncate mt-0.5">{connectionSubtext(conn)}</div>
                )}
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[11px] text-zinc-600 font-mono truncate">
                    {tokenVisible.has(conn.id) ? connectionToken(conn) : '\u2022'.repeat(Math.min(connectionToken(conn).length, 20))}
                  </span>
                  <button
                    onClick={() => toggleTokenVisibility(conn.id)}
                    className="text-zinc-500 hover:text-zinc-300 shrink-0"
                  >
                    {tokenVisible.has(conn.id)
                      ? <EyeOff className="w-3 h-3" />
                      : <Eye className="w-3 h-3" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => startEdit(conn)}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleRemove(conn.id)}
                  className="text-zinc-500 hover:text-red-400 p-0.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add new connection */}
      {showForm ? (
        <form onSubmit={handleAdd} className="border border-zinc-700 rounded-md p-3 space-y-2">
          <div className="text-xs text-zinc-300 font-medium">New Connection</div>
          <div className="space-y-1">
            <label className="text-[11px] text-zinc-400 font-medium">Provider</label>
            <select
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
              value={providerType}
              onChange={e => setProviderType(e.target.value as ProviderType)}
            >
              {PROVIDER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {providerType === 'jira'
            ? renderJiraFields(jiraForm, setJiraForm, false)
            : renderGiteaFields(giteaForm, setGiteaForm, false)}
          {error && <div className="text-[11px] text-red-400">{error}</div>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError('') }}
              className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={testing}
              className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-3 py-1 transition-colors"
            >
              {testing ? 'Connecting...' : 'Add Connection'}
            </button>
          </div>
          {providerType === 'jira' && (
            <div className="text-[10px] text-zinc-500 leading-relaxed">
              Create an API token at{' '}
              <span className="text-zinc-400">id.atlassian.com/manage-profile/security/api-tokens</span>
            </div>
          )}
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add connection
        </button>
      )}
    </div>
  )
}
