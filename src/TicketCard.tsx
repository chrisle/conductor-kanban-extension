import React, { memo, useState, useRef, useEffect, lazy, Suspense } from 'react'
import {
  Bug, Bookmark, CircleCheck, Loader2,
  GitBranch, ArrowUp, ArrowDown, Minus, Terminal, Code2,
  ExternalLink, Play, PlayCircle, MoreHorizontal,
  SquareArrowOutUpRight, BotMessageSquare, FileText, Trash2,
} from 'lucide-react'
import { useWorkSessionsStore, ui } from '@conductor/extension-api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Ticket, ProviderConnection } from './types'
import type { Provider } from './providers/provider'

const {
  ClaudeIcon, Badge,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
  LinkContextMenu,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
  Dialog, DialogContent, DialogTitle,
} = ui

interface WorkSession {
  id: string
  ticketKey?: string
  status: string
  worktree?: { path: string; branch: string; baseBranch: string }
  prUrl?: string | null
  [key: string]: any
}

interface TicketCardProps {
  ticket: Ticket
  connection: ProviderConnection
  provider: Provider
  isThinking: boolean
  isStarting: boolean
  workSession?: WorkSession
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
}

const STATUS_LOZENGE: Record<string, string> = {
  backlog: 'bg-zinc-700/40 text-zinc-300',
  in_progress: 'bg-blue-900/40 text-blue-400',
  done: 'bg-emerald-900/40 text-emerald-400',
}

const STATUS_LABEL: Record<string, string> = {
  backlog: 'TO DO',
  in_progress: 'IN PROGRESS',
  done: 'DONE',
}

const TYPE_BORDER: Record<string, string> = {
  bug: 'border-l-red-500',
  story: 'border-l-emerald-500',
  task: 'border-l-blue-500',
}

function PriorityIcon({ priority }: { priority: string | null }) {
  if (!priority) return null
  const p = priority.toLowerCase()
  let icon: React.ReactNode
  if (p === 'highest' || p === 'critical') icon = <ArrowUp className="h-3 w-3 text-red-500" />
  else if (p === 'high') icon = <ArrowUp className="h-3 w-3 text-orange-500" />
  else if (p === 'low') icon = <ArrowDown className="h-3 w-3 text-blue-400" />
  else if (p === 'lowest') icon = <ArrowDown className="h-3 w-3 text-blue-300" />
  else icon = <Minus className="h-3 w-3 text-yellow-500" />
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center">{icon}</span>
        </TooltipTrigger>
        <TooltipContent>{priority}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function IssueTypeIcon({ type }: { type: string }) {
  const t = type.toLowerCase()
  if (t === 'bug') return <Bug className="h-3.5 w-3.5 shrink-0 text-red-500" />
  if (t === 'story') return <Bookmark className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
  return <CircleCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
}

export const TicketCard = memo(function TicketCard({
  ticket,
  connection,
  provider,
  isThinking,
  isStarting,
  workSession,
  onOpenUrl,
  onNewSession,
  onContinueSession,
  onStartWork,
  onStartWorkInBackground,
  onEditTicket,
  onOpenInTerminal,
  onOpenInVSCode,
  onOpenInClaude,
  onRefresh,
}: TicketCardProps) {
  const [jiraLoading, setJiraLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(ticket.summary)
  const [descOpen, setDescOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const sessionActive = workSession?.status === 'active'
  const issueTypeLower = ticket.issueType?.toLowerCase() ?? 'task'
  const leftBorder = TYPE_BORDER[issueTypeLower] || TYPE_BORDER.task

  // Auto-resize textarea
  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
      el.focus()
      el.select()
    }
  }, [editing])

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(ticket.summary)
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setEditValue(ticket.summary)
  }

  const saveEditing = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === ticket.summary) {
      cancelEditing()
      return
    }
    setEditing(false)
    try {
      await provider.updateTicket(connection, ticket.key, { summary: trimmed })
      onRefresh()
    } catch (err) {
      console.error('Failed to update summary:', err)
      setEditValue(ticket.summary)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      saveEditing()
    }
    if (e.key === 'Escape') {
      cancelEditing()
    }
  }

  const handleTransition = async (status: string) => {
    setJiraLoading(true)
    try {
      await provider.transitionTicket(connection, ticket.key, status)
      if (status === 'Done' && workSession) {
        await useWorkSessionsStore.getState().completeSession(workSession.id)
      }
      onRefresh()
    } catch (err) {
      console.error('Failed to transition ticket:', err)
    } finally {
      setJiraLoading(false)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`group relative overflow-hidden rounded bg-jira-surface border border-jira-raised shadow-sm hover:bg-jira-hovered hover:shadow-md transition-all${isThinking ? ' thinking-halo' : ''}`}
        >
          {/* Meatball menu — top-right, always visible */}
          <div className="absolute top-2 right-2 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center justify-center h-5 w-5 rounded text-white hover:text-zinc-300 hover:bg-jira-raised transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" className="w-52 bg-zinc-900/80 backdrop-blur-xl border-zinc-700 shadow-xl shadow-black/50">
                {/* Start coding */}
                {sessionActive ? (
                  <DropdownMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onContinueSession(ticket)}>
                    <ClaudeIcon className="w-3.5 h-3.5 text-[#D97757]" />
                    Continue session
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="gap-2 text-xs cursor-pointer" disabled={isStarting} onSelect={() => onStartWork(ticket)}>
                    {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {isStarting ? 'Starting...' : 'Start code'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="gap-2 text-xs cursor-pointer" disabled={isStarting} onSelect={() => onStartWorkInBackground(ticket)}>
                  {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                  Start code (background)
                </DropdownMenuItem>

                <DropdownMenuSeparator className="bg-zinc-700" />

                <DropdownMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onOpenInTerminal(ticket)}>
                  <Terminal className="w-3.5 h-3.5" />
                  Open worktree in Terminal
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onOpenInVSCode(ticket)}>
                  <Code2 className="w-3.5 h-3.5" />
                  Open worktree in VSCode
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onOpenInClaude(ticket)}>
                  <BotMessageSquare className="w-3.5 h-3.5" />
                  Open worktree in Claude
                </DropdownMenuItem>

                <DropdownMenuSeparator className="bg-zinc-700" />

                <DropdownMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => setDescOpen(true)} disabled={!ticket.description}>
                  <FileText className="w-3.5 h-3.5" />
                  View description
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onEditTicket(ticket)}>
                  <ExternalLink className="w-3.5 h-3.5" />
                  Edit ticket
                </DropdownMenuItem>

                <DropdownMenuSeparator className="bg-zinc-700" />

                {/* Move to */}
                <DropdownMenuItem
                  className="gap-2 text-xs cursor-pointer"
                  disabled={jiraLoading}
                  onSelect={() => handleTransition('Backlog')}
                >
                  {jiraLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-zinc-500 ml-0.5 mr-0.5 shrink-0" />}
                  Move to Backlog
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 text-xs cursor-pointer"
                  disabled={jiraLoading}
                  onSelect={() => handleTransition('In Progress')}
                >
                  {jiraLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-blue-500 ml-0.5 mr-0.5 shrink-0" />}
                  Move to In Progress
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 text-xs cursor-pointer"
                  disabled={jiraLoading}
                  onSelect={() => handleTransition('Done')}
                >
                  {jiraLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-emerald-500 ml-0.5 mr-0.5 shrink-0" />}
                  Move to Done
                </DropdownMenuItem>

                <DropdownMenuSeparator className="bg-zinc-700" />

                {provider.supportsDelete && (
                  <DropdownMenuItem
                    className="gap-2 text-xs cursor-pointer text-red-400 focus:text-red-300"
                    disabled={jiraLoading}
                    onSelect={async () => {
                      setJiraLoading(true)
                      try {
                        await provider.deleteTicket(connection, ticket.key)
                        onRefresh()
                      } catch (err) {
                        console.error('Failed to delete ticket:', err)
                      } finally {
                        setJiraLoading(false)
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete ticket
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Card body */}
          <div className="px-3 py-2.5">
            {/* Summary — click to edit inline */}
            {editing ? (
              <textarea
                ref={textareaRef}
                value={editValue}
                onChange={(e) => {
                  setEditValue(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                onKeyDown={handleKeyDown}
                onBlur={saveEditing}
                className="mb-2 w-full resize-none overflow-hidden rounded bg-jira-raised px-1.5 pr-5 py-1 text-[13px] leading-snug text-zinc-50 outline-none ring-1 ring-blue-500/60 focus:ring-blue-500"
                rows={1}
              />
            ) : (
              <p
                className="mb-2 pr-5 text-[13px] leading-snug text-zinc-50 cursor-text hover:bg-jira-raised/50 rounded px-1 -mx-1 py-0.5 transition-colors"
                onClick={startEditing}
                title="Click to edit"
              >
                {ticket.summary}
              </p>
            )}

            {/* Footer row: type icon + key + priority on the left, badges on the right — single line */}
            <div className="flex items-center gap-1.5">
              <IssueTypeIcon type={issueTypeLower} />

              <LinkContextMenu url={provider.issueUrl(connection, ticket.key)} title={ticket.key} openInAppLabel="Go to Kanban Board" openExternalLabel={`Open in ${provider.displayName}`}>
                <button
                  onClick={() => onOpenUrl(provider.issueUrl(connection, ticket.key), ticket.key)}
                  className="shrink-0 text-xs font-medium text-zinc-400 hover:text-blue-400 transition-colors"
                >
                  {ticket.key}
                </button>
              </LinkContextMenu>

              <PriorityIcon priority={ticket.priority} />

              {/* Spacer pushes everything after it to the right */}
              <span className="flex-1" />

              {isStarting && (
                <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" title="Starting session..." />
              )}

              {!isStarting && sessionActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" title="Active session" />
              )}

              {/* Branch badge */}
              {workSession?.worktree?.branch && (
                <Badge variant="outline" className="h-4 px-1.5 gap-0.5 text-[10px] text-fuchsia-400 border-fuchsia-900/50 bg-fuchsia-950/20 max-w-[80px] truncate shrink-0">
                  <GitBranch className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{workSession.worktree.branch}</span>
                </Badge>
              )}

              {/* PR from active worktree session */}
              {workSession?.prUrl && (
                <LinkContextMenu url={workSession.prUrl} title="PR">
                  <Badge
                    variant="secondary"
                    className="cursor-pointer text-[10px] bg-blue-900/50 text-blue-400 hover:bg-blue-800/50 shrink-0"
                    onClick={() => onOpenUrl(workSession.prUrl!, 'PR')}
                  >
                    PR
                  </Badge>
                </LinkContextMenu>
              )}

              {/* PR badges from ticket */}
              {ticket.pullRequests.map((pr) => {
                const isMerged = pr.status === 'MERGED'
                const prNum = pr.url.match(/\/pull\/(\d+)/)?.[1]
                return (
                  <LinkContextMenu key={pr.id} url={pr.url} title={`PR #${prNum}`}>
                    <Badge
                      variant="secondary"
                      className={`cursor-pointer text-[10px] shrink-0 ${
                        isMerged
                          ? 'bg-emerald-900/50 text-emerald-400 hover:bg-emerald-800/50 hover:text-emerald-300'
                          : 'bg-blue-900/50 text-blue-400 hover:bg-blue-800/50 hover:text-blue-300'
                      }`}
                      onClick={() => onOpenUrl(pr.url, `PR #${prNum}`)}
                    >
                      PR#{prNum}
                    </Badge>
                  </LinkContextMenu>
                )
              })}

              {/* Story points */}
              {ticket.storyPoints != null && (
                <Badge variant="secondary" className="h-5 w-5 items-center justify-center rounded-full bg-jira-raised px-0 text-[10px] text-zinc-400 shrink-0">
                  {ticket.storyPoints}
                </Badge>
              )}
            </div>

          </div>
        </div>
      </ContextMenuTrigger>

      {/* Right-click context menu */}
      <ContextMenuContent className="w-44 bg-zinc-900/80 backdrop-blur-xl border-zinc-700">
        {sessionActive && (
          <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onContinueSession(ticket)}>
            <ClaudeIcon className="w-3.5 h-3.5 text-[#D97757]" />
            Continue session
          </ContextMenuItem>
        )}
        <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onNewSession(ticket)}>
          <ClaudeIcon className="w-3.5 h-3.5 text-[#D97757]" />
          Open in Claude
        </ContextMenuItem>
        <ContextMenuItem className="gap-2 text-xs cursor-pointer" disabled={isStarting} onSelect={() => onStartWork(ticket)}>
          {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {isStarting ? 'Starting...' : 'Start code'}
        </ContextMenuItem>
        <ContextMenuItem className="gap-2 text-xs cursor-pointer" disabled={isStarting} onSelect={() => onStartWorkInBackground(ticket)}>
          {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
          Start code (background)
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-zinc-700" />

        <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onOpenInTerminal(ticket)}>
          <Terminal className="w-3.5 h-3.5" />
          Open worktree in Terminal
        </ContextMenuItem>
        <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onOpenInVSCode(ticket)}>
          <Code2 className="w-3.5 h-3.5" />
          Open worktree in VSCode
        </ContextMenuItem>
        <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onOpenInClaude(ticket)}>
          <BotMessageSquare className="w-3.5 h-3.5" />
          Open worktree in Claude
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-zinc-700" />

        <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => setDescOpen(true)} disabled={!ticket.description}>
          <FileText className="w-3.5 h-3.5" />
          View description
        </ContextMenuItem>
        <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onEditTicket(ticket)}>
          <ExternalLink className="w-3.5 h-3.5" />
          Edit ticket
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2 text-xs cursor-pointer">
            <span className="h-2 w-2 rounded-full bg-zinc-500 ml-0.5" />
            Move to
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="bg-zinc-900/80 backdrop-blur-xl border-zinc-700">
            <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => handleTransition('Backlog')}>
              <span className="h-2 w-2 rounded-full bg-zinc-500" />
              Backlog
            </ContextMenuItem>
            <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => handleTransition('In Progress')}>
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              In Progress
            </ContextMenuItem>
            <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => handleTransition('Done')}>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Done
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator className="bg-zinc-700" />

        <ContextMenuItem className="gap-2 text-xs cursor-pointer" onSelect={() => onOpenUrl(provider.issueUrl(connection, ticket.key), ticket.key)}>
          <ExternalLink className="w-3.5 h-3.5" />
          Open in {provider.displayName}
        </ContextMenuItem>
        {ticket.pullRequests.filter(pr => pr.status === 'OPEN').map((pr) => (
          <ContextMenuItem key={pr.id} className="gap-2 text-xs cursor-pointer" onSelect={() => onOpenUrl(pr.url, pr.name)}>
            <SquareArrowOutUpRight className="w-3.5 h-3.5" />
            Open PR #{pr.url.match(/\/pull\/(\d+)/)?.[1]}
          </ContextMenuItem>
        ))}

        <ContextMenuSeparator className="bg-zinc-700" />

        {provider.supportsDelete && (
          <ContextMenuItem
            className="gap-2 text-xs cursor-pointer text-red-400 focus:text-red-300"
            onSelect={async () => {
              try {
                await provider.deleteTicket(connection, ticket.key)
                onRefresh()
              } catch (err) {
                console.error('Failed to delete ticket:', err)
              }
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete ticket
          </ContextMenuItem>
        )}
      </ContextMenuContent>

      {/* Description dialog */}
      <Dialog open={descOpen} onOpenChange={setDescOpen}>
        <DialogContent className="bg-zinc-900/80 backdrop-blur-xl border-zinc-700 max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0" hideClose>
          {/* Header */}
          <div className="px-5 pt-5 pb-3 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <IssueTypeIcon type={issueTypeLower} />
              <span className="text-xs font-medium text-zinc-400">{ticket.key}</span>
            </div>
            <DialogTitle className="text-base font-medium text-zinc-100 leading-snug">
              {ticket.summary}
            </DialogTitle>
            {/* Metadata pills */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_LOZENGE[ticket.status]}`}>
                {STATUS_LABEL[ticket.status]}
              </span>
              <span className="inline-flex items-center rounded-sm bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                {ticket.issueType}
              </span>
              {ticket.priority && (
                <span className="inline-flex items-center gap-1 rounded-sm bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                  <PriorityIcon priority={ticket.priority} />
                  {ticket.priority}
                </span>
              )}
              {ticket.storyPoints != null && (
                <span className="inline-flex items-center rounded-sm bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                  {ticket.storyPoints} SP
                </span>
              )}
              {ticket.epic && (
                <span className="inline-flex items-center gap-1 rounded-sm bg-indigo-950/50 px-2 py-0.5 text-[11px] text-indigo-300">
                  {ticket.epic.key} — {ticket.epic.summary}
                </span>
              )}
            </div>
          </div>
          {/* Description body */}
          <div className="overflow-y-auto px-5 py-4 prose prose-sm prose-invert max-w-none
            prose-headings:text-zinc-200 prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
            prose-h2:text-sm prose-h3:text-xs
            prose-p:text-zinc-300 prose-p:text-[13px] prose-p:leading-relaxed prose-p:my-1.5
            prose-strong:text-zinc-200
            prose-code:text-pink-400 prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
            prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-lg
            prose-blockquote:border-zinc-700 prose-blockquote:text-zinc-400
            prose-li:text-zinc-300 prose-li:text-[13px]
            prose-ul:my-1 prose-ol:my-1
            prose-th:text-zinc-200 prose-th:text-xs prose-td:text-zinc-300 prose-td:text-xs
            prose-hr:border-zinc-800
          ">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {ticket.description || '*No description*'}
            </ReactMarkdown>
          </div>
        </DialogContent>
      </Dialog>
    </ContextMenu>
  )
})
