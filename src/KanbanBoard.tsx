import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ui, type ThinkingState } from '@conductor/extension-api'
import { KanbanColumn } from './KanbanColumn'
import type { PendingTicket } from './KanbanColumn'
import type { Ticket, Epic, TicketStatus, JiraConfig } from './jira-api'

const { Collapsible, CollapsibleTrigger, CollapsibleContent, Badge } = ui

// Re-use the WorkSession shape from the host store
interface WorkSession {
  id: string
  ticketKey?: string
  status: string
  worktree?: { path: string; branch: string; baseBranch: string }
  prUrl?: string | null
  [key: string]: any
}

const COLUMNS: { title: string; status: TicketStatus }[] = [
  { title: 'Backlog', status: 'backlog' },
  { title: 'In Progress', status: 'in_progress' },
  { title: 'Done', status: 'done' },
]

interface KanbanBoardProps {
  tickets: Ticket[]
  epics: Epic[]
  config: JiraConfig
  jiraBaseUrl: string
  pendingTickets?: PendingTicket[]
  startingTickets?: Set<string>
  sessionThinking: Record<string, ThinkingState>
  hideDoneColumn?: boolean
  onOpenUrl: (url: string, title: string) => void
  onNewSession: (ticket: Ticket) => void
  onContinueSession: (ticket: Ticket) => void
  onStartWork: (ticket: Ticket) => void
  onStartWorkInBackground: (ticket: Ticket) => void
  onEditTicket: (ticket: Ticket) => void
  onOpenInTerminal: (ticket: Ticket) => void
  onOpenInVSCode: (ticket: Ticket) => void
  onOpenInClaude: (ticket: Ticket) => void
  onRefresh: () => void
  onCreateTicket?: (status: TicketStatus, epicKey: string | null) => void
  onInlineCreate?: (status: TicketStatus, epicKey: string | null, summary: string) => void
  workSessions?: WorkSession[]
}

export function KanbanBoard({ tickets, epics, config, jiraBaseUrl, pendingTickets = [], startingTickets, sessionThinking, hideDoneColumn = false, onOpenUrl, onNewSession, onContinueSession, onStartWork, onStartWorkInBackground, onEditTicket, onOpenInTerminal, onOpenInVSCode, onOpenInClaude, onRefresh, onCreateTicket, onInlineCreate, workSessions = [] }: KanbanBoardProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Filter out the done column when the user has chosen to hide it
  const visibleColumns = hideDoneColumn ? COLUMNS.filter(c => c.status !== 'done') : COLUMNS

  const epicKeys = epics.map((e) => e.key)
  const ungroupedTickets = tickets.filter((t) => !t.epicKey || !epicKeys.includes(t.epicKey))

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const columnProps = { config, jiraBaseUrl, startingTickets, sessionThinking, onOpenUrl, onNewSession, onContinueSession, onStartWork, onStartWorkInBackground, onEditTicket, onOpenInTerminal, onOpenInVSCode, onOpenInClaude, onRefresh, workSessions }

  return (
    <div className="h-full overflow-auto p-4 space-y-4 min-w-0">
      {epics.map((epic) => {
        const epicTickets = tickets.filter((t) => t.epicKey === epic.key)
        if (epicTickets.length === 0 && !pendingTickets.some(p => p.epicKey === epic.key)) return null

        const isCollapsed = collapsed.has(epic.key)
        const counts = visibleColumns.map((col) => epicTickets.filter((t) => t.status === col.status).length)
        const epicPending = pendingTickets.filter(p => p.epicKey === epic.key)

        return (
          <Collapsible key={epic.key} open={!isCollapsed} onOpenChange={() => toggle(epic.key)} asChild>
            <section>
              {/* Swimlane header */}
              <CollapsibleTrigger className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-jira-raised/30 transition-colors">
                {isCollapsed
                  ? <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                  : <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                }
                <span className="text-xs font-semibold text-zinc-200">{epic.summary}</span>
                <span className="text-[11px] text-zinc-600">{epic.key}</span>
                <div className="ml-auto flex gap-1.5">
                  {visibleColumns.map((col, i) => (
                    counts[i] > 0 && (
                      <span key={col.status} className="text-[10px] text-zinc-600">
                        {counts[i]}
                      </span>
                    )
                  ))}
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(280px, 1fr))` }}>
                  {visibleColumns.map((col) => (
                    <KanbanColumn
                      key={col.status}
                      title={col.title}
                      status={col.status}
                      tickets={epicTickets}
                      pendingTickets={epicPending}
                      onCreateTicket={onCreateTicket ? (status) => onCreateTicket(status, epic.key) : undefined}
                      onInlineCreate={onInlineCreate ? (status, summary) => onInlineCreate(status, epic.key, summary) : undefined}
                      {...columnProps}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </section>
          </Collapsible>
        )
      })}

      {(ungroupedTickets.length > 0 || pendingTickets.some(p => !p.epicKey)) && (
        <Collapsible open={!collapsed.has('__ungrouped')} onOpenChange={() => toggle('__ungrouped')} asChild>
          <section>
            <CollapsibleTrigger className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-jira-raised/30 transition-colors">
              {collapsed.has('__ungrouped')
                ? <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                : <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
              }
              <span className="text-xs font-semibold text-zinc-200">Ungrouped</span>
              <div className="ml-auto flex gap-1.5">
                {visibleColumns.map((col) => {
                  const count = ungroupedTickets.filter((t) => t.status === col.status).length
                  return count > 0 && (
                    <span key={col.status} className="text-[10px] text-zinc-600">
                      {count}
                    </span>
                  )
                })}
              </div>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(280px, 1fr))` }}>
                {visibleColumns.map((col) => (
                  <KanbanColumn
                    key={col.status}
                    title={col.title}
                    status={col.status}
                    tickets={ungroupedTickets}
                    pendingTickets={pendingTickets.filter(p => !p.epicKey)}
                    onCreateTicket={onCreateTicket ? (status) => onCreateTicket(status, null) : undefined}
                    onInlineCreate={onInlineCreate ? (status, summary) => onInlineCreate(status, null, summary) : undefined}
                    {...columnProps}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>
      )}
    </div>
  )
}
