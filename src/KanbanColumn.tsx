import { useState, useMemo, useRef, useEffect } from 'react'
import { ArrowUpDown, Plus, Minimize2, Maximize2 } from 'lucide-react'
import { useConfigStore, ui, type ThinkingState } from '@conductor/extension-api'
import { TicketCard } from './TicketCard'
import type { Ticket, TicketStatus, JiraConfig } from './jira-api'

const {
  Badge, Skeleton, DropdownMenu, DropdownMenuTrigger,
  DropdownMenuContent, DropdownMenuItem, LinkContextMenu,
} = ui

interface WorkSession {
  id: string
  ticketKey?: string
  status: string
  worktree?: { path: string; branch: string; baseBranch: string }
  prUrl?: string | null
  [key: string]: any
}

type SortMode = 'none' | 'modified_desc' | 'modified_asc'

export interface PendingTicket {
  tempId: string
  status: TicketStatus
  epicKey: string | null
}

interface KanbanColumnProps {
  title: string
  status: TicketStatus
  tickets: Ticket[]
  pendingTickets?: PendingTicket[]
  startingTickets?: Set<string>
  config: JiraConfig
  jiraBaseUrl: string
  sessionThinking: Record<string, ThinkingState>
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
  onCreateTicket?: (status: TicketStatus) => void
  onInlineCreate?: (status: TicketStatus, summary: string) => void
  workSessions?: WorkSession[]
}

// Jira-style colored dots for column status headers
const STATUS_DOT_COLOR: Record<TicketStatus, string> = {
  backlog: 'bg-zinc-500',
  in_progress: 'bg-blue-500',
  done: 'bg-emerald-500',
}

// Neutral white column headers — matching Jira's clean dark aesthetic
const STATUS_TEXT_COLOR: Record<TicketStatus, string> = {
  backlog: 'text-zinc-100',
  in_progress: 'text-zinc-100',
  done: 'text-zinc-100',
}

const SORT_LABELS: Record<SortMode, string> = {
  none: 'Default',
  modified_desc: 'Modified (Newest)',
  modified_asc: 'Modified (Oldest)',
}

function getCompactColumns(): Set<string> {
  const columns = useConfigStore.getState().config.ui.kanbanCompactColumns
  return columns.length > 0 ? new Set(columns) : new Set(['done'])
}

function saveCompactColumns(set: Set<string>) {
  useConfigStore.getState().setKanbanCompactColumns([...set])
}

export function KanbanColumn({ title, status, tickets, pendingTickets = [], startingTickets, config, jiraBaseUrl, sessionThinking, onOpenUrl, onNewSession, onContinueSession, onStartWork, onStartWorkInBackground, onEditTicket, onOpenInTerminal, onOpenInVSCode, onOpenInClaude, onRefresh, onCreateTicket, onInlineCreate, workSessions = [] }: KanbanColumnProps) {
  const [sort, setSort] = useState<SortMode>('none')
  const [compact, setCompact] = useState(() => getCompactColumns().has(status))
  const [inlineCreating, setInlineCreating] = useState(false)
  const [inlineValue, setInlineValue] = useState('')
  const inlineInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inlineCreating) inlineInputRef.current?.focus()
  }, [inlineCreating])

  const submitInlineCreate = () => {
    const trimmed = inlineValue.trim()
    if (trimmed && onInlineCreate) {
      onInlineCreate(status, trimmed)
    }
    setInlineValue('')
    setInlineCreating(false)
  }

  const toggleCompact = () => {
    const next = !compact
    setCompact(next)
    const set = getCompactColumns()
    if (next) set.add(status); else set.delete(status)
    saveCompactColumns(set)
  }

  const columnTickets = useMemo(() => {
    const filtered = tickets.filter((t) => t.status === status)
    if (sort === 'none') return filtered
    const dir = sort === 'modified_asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime()
      const bTime = new Date(b.updatedAt).getTime()
      return (aTime - bTime) * dir
    })
  }, [tickets, status, sort])

  const columnPending = pendingTickets.filter((p) => p.status === status)

  return (
    <div className="flex flex-col rounded-lg bg-jira-sunken p-2">
      {/* Column header: colored dot + title + count */}
      <div className="mb-2 flex shrink-0 items-center gap-2 px-1">
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT_COLOR[status]}`} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${STATUS_TEXT_COLOR[status]}`}>
          {title}
        </span>
        <span className="text-xs text-zinc-600">
          {columnTickets.length}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-jira-raised ${
                  sort !== 'none' ? 'text-violet-400' : 'text-zinc-600'
                }`}
              >
              <ArrowUpDown className="h-3 w-3" />
              {sort !== 'none' && SORT_LABELS[sort]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
              <DropdownMenuItem
                key={mode}
                onSelect={() => setSort(mode)}
                className={sort === mode ? 'text-violet-400' : ''}
              >
                {SORT_LABELS[mode]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={toggleCompact}
            className="flex items-center justify-center rounded p-1 text-zinc-600 transition-colors hover:bg-jira-raised hover:text-zinc-400"
            title={compact ? 'Expand' : 'Shrink'}
          >
            {compact ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
          </button>

          {onCreateTicket && (
            <button
              onClick={() => onCreateTicket(status)}
              className="flex items-center justify-center rounded p-1 text-zinc-600 transition-colors hover:bg-jira-raised hover:text-zinc-400"
              title="New ticket"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto ${compact ? 'space-y-0.5' : 'space-y-1.5'}`}>
        {compact ? (
          columnTickets.map((ticket) => {
            const prNum = ticket.pullRequests[0]?.url.match(/\/pull\/(\d+)/)?.[1]
            const prUrl = ticket.pullRequests[0]?.url
            const isMerged = ticket.pullRequests[0]?.status === 'MERGED'
            return (
              <div key={ticket.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-jira-raised/50">
                <LinkContextMenu url={`${jiraBaseUrl}/browse/${ticket.key}`} title={ticket.key} openInAppLabel="Go to Kanban Board" openExternalLabel="Open Jira">
                  <button
                    onClick={() => onOpenUrl(`${jiraBaseUrl}/browse/${ticket.key}`, ticket.key)}
                    className="shrink-0 text-xs font-medium text-zinc-400 hover:text-blue-400"
                  >
                    {ticket.key}
                  </button>
                </LinkContextMenu>
                <span className="min-w-0 truncate text-xs text-zinc-400">{ticket.summary}</span>
                {prNum && prUrl && (
                  <LinkContextMenu url={prUrl} title={`PR #${prNum}`}>
                    <Badge
                      variant="secondary"
                      className={`ml-auto shrink-0 cursor-pointer text-[10px] ${
                        isMerged
                          ? 'bg-emerald-900/50 text-emerald-400 hover:bg-emerald-800/50 hover:text-emerald-300'
                          : 'bg-blue-900/50 text-blue-400 hover:bg-blue-800/50 hover:text-blue-300'
                      }`}
                      onClick={() => onOpenUrl(prUrl, `PR #${prNum}`)}
                    >
                      PR#{prNum}
                    </Badge>
                  </LinkContextMenu>
                )}
              </div>
            )
          })
        ) : (
          <>
            {columnTickets.map((ticket) => (
              <TicketCard
                key={ticket.key}
                ticket={ticket}
                config={config}
                jiraBaseUrl={jiraBaseUrl}
                isThinking={sessionThinking[`t-${ticket.key}`]?.thinking ?? false}
                isStarting={startingTickets?.has(ticket.key) ?? false}
                workSession={workSessions.find(s => s.ticketKey === ticket.key && s.status !== 'completed')}
                onOpenUrl={onOpenUrl}
                onNewSession={onNewSession}
                onContinueSession={onContinueSession}
                onStartWork={onStartWork}
                onStartWorkInBackground={onStartWorkInBackground}
                onEditTicket={onEditTicket}
                onOpenInTerminal={onOpenInTerminal}
                onOpenInVSCode={onOpenInVSCode}
                onOpenInClaude={onOpenInClaude}
                onRefresh={onRefresh}
              />
            ))}
            {columnPending.map((p) => (
              <div key={p.tempId} className="rounded border-l-[3px] border-l-zinc-600 border border-jira-raised bg-jira-surface p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-3.5 rounded-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </>
        )}
        {columnTickets.length === 0 && columnPending.length === 0 && !inlineCreating && (
          <p className="py-8 text-center text-xs text-zinc-600">No tickets</p>
        )}

        {inlineCreating && (
          <div className="rounded border border-jira-raised bg-jira-surface p-2">
            <input
              ref={inlineInputRef}
              value={inlineValue}
              onChange={(e) => setInlineValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitInlineCreate()
                if (e.key === 'Escape') { setInlineCreating(false); setInlineValue('') }
              }}
              onBlur={submitInlineCreate}
              placeholder="What needs to be done?"
              className="w-full bg-transparent text-[13px] text-zinc-100 placeholder-zinc-600 outline-none"
            />
          </div>
        )}
      </div>

      {onInlineCreate && !inlineCreating && (
        <button
          onClick={() => setInlineCreating(true)}
          className="mt-1 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-zinc-500 hover:bg-jira-raised/50 hover:text-zinc-300 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Create
        </button>
      )}
    </div>
  )
}
