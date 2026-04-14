import React, { useState } from 'react'
import { Trash2, Eye, EyeOff, Plus } from 'lucide-react'
import { useConfigStore, ui } from '@conductor/extension-api'
import { type JiraConfig, fetchProjects, saveConfig, clearConfig, loadConfig } from './jira-api'

const { Button } = ui

export default function JiraConfigPanel(): React.ReactElement {
  const connections = useConfigStore((s: any) => s.config.jiraConnections) as Array<{
    id: string; name: string; domain: string; email: string; apiToken: string
  }>

  const addConnection = useConfigStore((s: any) => s.addJiraConnection)
  const updateConnection = useConfigStore((s: any) => s.updateJiraConnection)
  const removeConnection = useConfigStore((s: any) => s.removeJiraConnection)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ domain: '', email: '', apiToken: '' })
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [tokenVisible, setTokenVisible] = useState<Set<string>>(new Set())
  const [newTokenVisible, setNewTokenVisible] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ domain: '', email: '', apiToken: '' })
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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const config: JiraConfig = {
      domain: form.domain.trim(),
      email: form.email.trim(),
      apiToken: form.apiToken.trim(),
    }
    if (!config.domain || !config.email || !config.apiToken) {
      setError('All fields are required')
      return
    }
    setTesting(true)
    setError('')
    try {
      await fetchProjects(config)
      await addConnection({
        id: 'jira-' + config.domain,
        name: config.domain,
        domain: config.domain,
        email: config.email,
        apiToken: config.apiToken,
      })
      setForm({ domain: '', email: '', apiToken: '' })
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setTesting(false)
    }
  }

  function startEdit(conn: typeof connections[0]) {
    setEditingId(conn.id)
    setEditForm({ domain: conn.domain, email: conn.email, apiToken: conn.apiToken })
    setEditError('')
  }

  async function handleSaveEdit() {
    if (!editingId) return
    const config: JiraConfig = {
      domain: editForm.domain.trim(),
      email: editForm.email.trim(),
      apiToken: editForm.apiToken.trim(),
    }
    if (!config.domain || !config.email || !config.apiToken) {
      setEditError('All fields are required')
      return
    }
    setEditTesting(true)
    setEditError('')
    try {
      await fetchProjects(config)
      await updateConnection(editingId, {
        name: config.domain,
        domain: config.domain,
        email: config.email,
        apiToken: config.apiToken,
      })
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

  return (
    <div className="flex flex-col gap-4">
      <div className="text-ui-sm text-zinc-500 uppercase tracking-wider font-medium">
        Jira Connections
      </div>
      <div className="text-ui-sm text-zinc-500">
        Manage your Jira instance connections. The first connection is used as the active connection.
      </div>

      {/* Existing connections */}
      {connections.map(conn => (
        <div key={conn.id} className="border border-zinc-700 rounded-md p-3 space-y-2">
          {editingId === conn.id ? (
            <>
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400 font-medium">Domain</label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
                    placeholder="e.g. mycompany"
                    value={editForm.domain}
                    onChange={e => setEditForm(f => ({ ...f, domain: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400 font-medium">Email</label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
                    placeholder="you@example.com"
                    value={editForm.email}
                    onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400 font-medium">API Token</label>
                  <input
                    type="password"
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
                    placeholder="API token"
                    value={editForm.apiToken}
                    onChange={e => setEditForm(f => ({ ...f, apiToken: e.target.value }))}
                  />
                </div>
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
                <div className="text-xs text-zinc-200 font-medium">
                  {conn.domain.replace(/\.atlassian\.net$/, '')}.atlassian.net
                </div>
                <div className="text-[11px] text-zinc-500 truncate">{conn.email}</div>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[11px] text-zinc-600 font-mono truncate">
                    {tokenVisible.has(conn.id) ? conn.apiToken : '\u2022'.repeat(Math.min(conn.apiToken.length, 20))}
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
          </div>
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
          <div className="text-[10px] text-zinc-500 leading-relaxed">
            Create an API token at{' '}
            <span className="text-zinc-400">id.atlassian.com/manage-profile/security/api-tokens</span>
          </div>
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
