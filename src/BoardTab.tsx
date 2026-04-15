import React, { useEffect, useState, useCallback, useRef } from "react";
import { RefreshCw, Search, Radio, EyeOff, Eye } from "lucide-react";
import {
  useTabsStore, useLayoutStore, useSidebarStore, useConfigStore,
  useWorkSessionsStore, useProjectStore, createTerminal, killTerminal, setAutoPilot, ui,
  buildClaudeCommand,
} from "@conductor/extension-api";
import type { TabProps } from "@conductor/extension-sdk";
import { KanbanBoard } from "./KanbanBoard";
import { CreateTicketDialog } from "./CreateTicketDialog";
import { EditTicketDialog } from "./EditTicketDialog";
import type { PendingTicket } from "./KanbanColumn";
import type { Ticket, Epic, TicketStatus, ProviderConnection, UpdateTicketParams } from "./types";
import type { Provider } from "./providers/provider";
import { providerRegistry } from "./providers/provider";
import { useSessionThinking } from "./useSessionThinking";

const { Button } = ui;


// Persistent cache so the board renders instantly on app restart (file-based via IPC)
let _boardCachePromise: Map<string, Promise<{ tickets: Ticket[]; epics: Epic[] } | null>> = new Map()

function loadBoardCache(projectKey: string): Promise<{ tickets: Ticket[]; epics: Epic[] } | null> {
  if (!_boardCachePromise.has(projectKey)) {
    _boardCachePromise.set(projectKey, window.electronAPI.loadCache('kanban', projectKey))
  }
  return _boardCachePromise.get(projectKey)!
}

function saveBoardCache(projectKey: string, tickets: Ticket[], epics: Epic[]) {
  window.electronAPI.saveCache('kanban', projectKey, { tickets, epics })
}

/** Extract a domain/URL string from a provider connection for use in skill args */
function getDomain(connection: ProviderConnection | null): string {
  if (!connection) return ''
  if (connection.providerType === 'jira') return connection.domain
  if (connection.providerType === 'gitea') return connection.baseUrl
  return ''
}

export default function BoardTab({
  tabId,
  groupId,
  isActive,
  tab,
}: TabProps): React.ReactElement {
  const projectKey = tab.content || tab.title?.replace(/ Board$/, "").replace(/ Kanban Board$/, "") || "";
  const boardName = tab.title || `${projectKey} Kanban Board`;
  const [connection, setConnection] = useState<ProviderConnection | null>(() =>
    useConfigStore.getState().getActiveConnection()
  );

  const provider: Provider | null = connection ? providerRegistry.getForConnection(connection) : null;

  // If connection wasn't available at mount (store still loading), pick it up once ready
  const configReady = useConfigStore(s => s.ready);
  useEffect(() => {
    if (configReady && !connection) {
      setConnection(useConfigStore.getState().getActiveConnection());
    }
  }, [configReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const hideDoneColumn = useConfigStore(s => (s.getExtensionData('kanban').hideDoneColumn as boolean | undefined) ?? false);
  const setHideDoneColumn = (hide: boolean) => useConfigStore.getState().setExtensionData('kanban', { hideDoneColumn: hide });
  const workSessions = useWorkSessionsStore(s => s.sessions);
  const activeSessionNames = workSessions
    .filter(ws => ws.status === 'active' && ws.tmuxSessionId)
    .map(ws => ws.tmuxSessionId!);
  const sessionThinking = useSessionThinking(activeSessionNames);
  const [liveUpdate, setLiveUpdate] = useState(true);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef(30);
  const lastBoardFpRef = useRef('');
  const [pendingTickets, setPendingTickets] = useState<PendingTicket[]>([]);
  const [startingTickets, setStartingTickets] = useState<Set<string>>(new Set());
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [createDialog, setCreateDialog] = useState<{
    open: boolean;
    status: TicketStatus;
    epicKey: string | null;
  }>({
    open: false,
    status: "backlog",
    epicKey: null,
  });
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    ticket: Ticket | null;
  }>({ open: false, ticket: null });
  const { addTab } = useTabsStore();
  const { focusedGroupId } = useLayoutStore();
  const { rootPath } = useSidebarStore();

  // Tmux session name for a ticket — one session per ticket
  function tmuxSessionName(ticketKey: string): string {
    return `t-${ticketKey}`
  }

  const reconcileSessions = useCallback(async () => {
    try {
      const list = await window.electronAPI.conductordGetTmuxSessions()
      const liveNames = new Set(list.map((s) => s.name))

      // Complete work sessions whose tmux session no longer exists (or never had one)
      const sessionsStore = useWorkSessionsStore.getState()
      for (const ws of sessionsStore.sessions) {
        if (ws.status === 'active' && (!ws.tmuxSessionId || !liveNames.has(ws.tmuxSessionId))) {
          sessionsStore.completeSession(ws.id)
        }
      }
    } catch { /* conductord not running */ }
  }, [])

  /** Returns whether data changed (true) or was unchanged/errored (false). */
  const loadData = useCallback(async (silent = false): Promise<boolean> => {
    if (!projectKey) return false;

    if (!connection || !provider) return false;

    if (!silent) setLoading(true);
    setError("");
    try {
      const [ticketData, epicData] = await Promise.all([
        provider.fetchTickets(connection, projectKey),
        provider.fetchEpics(connection, projectKey),
      ]);

      const epicMap = new Map(epicData.map((e) => [e.key, e]));
      for (const t of ticketData) {
        if (t.epicKey) t.epic = epicMap.get(t.epicKey);
      }

      // Fetch PRs for active tickets before updating state
      const activeTickets = ticketData.filter(
        (t) => t.status === "in_progress" || t.status === "done",
      );
      const prResults = await Promise.all(
        activeTickets.map(async (t) => {
          const prs = await provider.fetchDevelopmentInfo(connection, t.key);
          return { key: t.key, prs };
        }),
      );

      // Merge PR data into tickets
      const prMap = new Map(prResults.map((r) => [r.key, r.prs]));
      for (const t of ticketData) {
        if (prMap.has(t.key)) t.pullRequests = prMap.get(t.key)!;
      }

      // Build fingerprint from the complete data — skip re-render if unchanged
      const fp = ticketData.map(t =>
        `${t.key}:${t.status}:${t.updatedAt}:${t.summary}:${t.priority}:${t.storyPoints}:${t.pullRequests.map(p => `${p.id}:${p.status}`).join(',')}`
      ).sort().join('\n')
        + '||' + epicData.map(e => `${e.key}:${e.summary}:${e.status}`).sort().join('\n');

      // Always update cache with latest data (cheap disk write)
      saveBoardCache(projectKey, ticketData, epicData);

      const changed = fp !== lastBoardFpRef.current;
      if (changed) {
        lastBoardFpRef.current = fp;
        setTickets(ticketData);
        setEpics(epicData);
      }
      reconcileSessions();
      return changed;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [connection, provider, projectKey]);

  // Load cached board data for instant render, then fetch fresh data
  const cacheAppliedRef = useRef(false);
  useEffect(() => {
    if (!projectKey) return;
    if (!connection) return;
    // Show cache instantly, but only before the first fresh fetch completes
    if (!cacheAppliedRef.current) {
      cacheAppliedRef.current = true;
      loadBoardCache(projectKey).then(cached => {
        if (cached && !lastBoardFpRef.current) {
          setTickets(cached.tickets);
          setEpics(cached.epics);
        }
      });
    }
    loadData();
  }, [connection, projectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+F focuses the filter input when this tab is active
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'f' && e.metaKey && !e.shiftKey) {
        e.preventDefault()
        filterInputRef.current?.focus()
        filterInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isActive])

  // Live polling — starts at 30s, backs off to 5min when data is unchanged
  const BASE_POLL_INTERVAL = 30
  const MAX_POLL_INTERVAL = 300
  useEffect(() => {
    if (!liveUpdate || !isActive || !connection || !projectKey) {
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current)
        liveTimerRef.current = null
      }
      pollIntervalRef.current = BASE_POLL_INTERVAL
      return
    }
    function schedulePoll() {
      liveTimerRef.current = setTimeout(async () => {
        const changed = await loadData(true)
        if (changed) {
          pollIntervalRef.current = BASE_POLL_INTERVAL
        } else {
          pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, MAX_POLL_INTERVAL)
        }
        schedulePoll()
      }, pollIntervalRef.current * 1000)
    }
    pollIntervalRef.current = BASE_POLL_INTERVAL
    schedulePoll()
    return () => {
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current)
        liveTimerRef.current = null
      }
    }
  }, [liveUpdate, isActive, connection, projectKey, loadData])

  function openUrl(url: string, title: string) {
    const targetGroup = focusedGroupId || groupId;
    addTab(targetGroup, { type: "browser", title, url });
  }

  async function resolveWorktree(
    ticket: Ticket,
  ): Promise<{ cwd: string }> {
    const sessionsStore = useWorkSessionsStore.getState();
    const session = sessionsStore.getActiveSessionForTicket(ticket.key);

    // Already have a worktree path in an existing session
    if (session?.worktree?.path) {
      return { cwd: session.worktree.path };
    }

    // Try to find or create a worktree
    const repoPath = rootPath;
    if (repoPath) {
      const worktrees = await window.electronAPI.worktreeList(repoPath);
      const branchLower = ticket.key.toLowerCase();
      const existing = worktrees.find((wt) =>
        wt.branch.toLowerCase().includes(branchLower),
      );

      if (existing) {
        const worktree = { path: existing.path, branch: existing.branch, baseBranch: 'main' };
        if (session) {
          await sessionsStore.updateSession(session.id, { worktree });
        } else {
          await sessionsStore.createSession({
            projectPath: useProjectStore.getState().filePath || '',
            ticketKey: ticket.key,
            providerConnectionId: '',
            worktree,
            sessionId: tmuxSessionName(ticket.key),
            claudeSessionId: null,
            prUrl: null,
            status: 'active',
          });
        }
        return { cwd: existing.path };
      }

      // Create a new worktree
      const branchName = ticket.key.toLowerCase();
      const result = await window.electronAPI.worktreeAdd(repoPath, branchName);
      if (result.success && result.path) {
        const worktree = { path: result.path, branch: branchName, baseBranch: 'main' };
        if (session) {
          await sessionsStore.updateSession(session.id, { worktree });
        } else {
          await sessionsStore.createSession({
            projectPath: useProjectStore.getState().filePath || '',
            ticketKey: ticket.key,
            providerConnectionId: '',
            worktree,
            sessionId: tmuxSessionName(ticket.key),
            claudeSessionId: null,
            prUrl: null,
            status: 'active',
          });
        }
        return { cwd: result.path };
      }

      throw new Error(`Failed to create worktree for ${ticket.key}: ${result.error || 'unknown error'}`);
    }

    throw new Error('No project root path available to create worktree');
  }

  async function newSession(ticket: Ticket) {
    const targetGroup = focusedGroupId || groupId;
    const tmuxName = tmuxSessionName(ticket.key);
    const { cwd } = await resolveWorktree(ticket);
    addTab(targetGroup, {
      id: tmuxName,
      type: "claude-code",
      title: `Claude · ${ticket.key}`,
      filePath: cwd,
      initialCommand: `claude\n`,
    });
    // Reconcile work sessions against live tmux after a short delay
    setTimeout(reconcileSessions, 1500);
  }

  async function continueSession(ticket: Ticket) {
    const targetGroup = focusedGroupId || groupId;
    const tmuxName = tmuxSessionName(ticket.key);
    const { cwd } = await resolveWorktree(ticket);
    // No initialCommand — conductord will attach to the running tmux session
    addTab(targetGroup, {
      id: tmuxName,
      type: "claude-code",
      title: `Claude · ${ticket.key}`,
      filePath: cwd,
    });
  }


  async function startWork(ticket: Ticket) {
    const targetGroup = focusedGroupId || groupId;
    const tmuxName = tmuxSessionName(ticket.key);

    setStartingTickets(prev => new Set(prev).add(ticket.key));

    // Kill any stale tmux session so conductord creates a fresh one
    // (returns isNew: true, enabling initialCommand to be sent).
    try {
      await window.electronAPI.conductordKillTmuxSession(tmuxName);
    } catch { /* session may not exist */ }

    // Kill stale WebSocket in the terminal bridge + activeSessions set
    await killTerminal(tmuxName);

    let cwd: string;
    try {
      const result = await resolveWorktree(ticket);
      cwd = result.cwd;
    } catch (err) {
      console.error('[startWork] resolveWorktree failed:', err);
      setError(`Failed to create worktree for ${ticket.key}: ${err instanceof Error ? err.message : 'unknown error'}`);
      setStartingTickets(prev => { const next = new Set(prev); next.delete(ticket.key); return next });
      return;
    }

    // Invoke the /conductor-start-work skill with ticket details as arguments
    const claudeSettings = useConfigStore.getState().config.aiCli.claudeCode
    const skillArgs = `/conductor-start-work ${ticket.key} ${projectKey} ${connection?.providerType ?? ''} ${getDomain(connection)}`
    const escaped = skillArgs.replace(/'/g, "'\\''")
    const initialCommand = buildClaudeCommand(`claude '${escaped}'\n`, claudeSettings);

    // If a tab with this ID already exists in the target group, update its
    // properties and bump refreshKey to force a full React remount.
    const existingGroup = useTabsStore.getState().groups[targetGroup];
    const existingTab = existingGroup?.tabs.find(t => t.id === tmuxName);

    if (existingTab) {
      useTabsStore.getState().updateTab(targetGroup, tmuxName, {
        filePath: cwd,
        initialCommand,
        autoPilot: true,
        refreshKey: (existingTab.refreshKey || 0) + 1,
      });
      useTabsStore.getState().setActiveTab(targetGroup, tmuxName);
    } else {
      // Remove from other groups if it exists there
      const allGroups = useTabsStore.getState().groups;
      for (const [gid, group] of Object.entries(allGroups)) {
        if (gid !== targetGroup && group.tabs.find(t => t.id === tmuxName)) {
          useTabsStore.getState().removeTab(gid, tmuxName);
        }
      }

      addTab(targetGroup, {
        id: tmuxName,
        type: "claude-code",
        title: `Claude · ${ticket.key}`,
        filePath: cwd,
        initialCommand,
        autoPilot: true,
      });
    }

    setStartingTickets(prev => { const next = new Set(prev); next.delete(ticket.key); return next });
    setTimeout(reconcileSessions, 1500);
    // Auto-transition ticket to "In Progress"
    if (connection && provider && ticket.status === 'backlog') {
      provider.transitionTicket(connection, ticket.key, 'In Progress').catch(() => {})
    }
  }

  async function startWorkInBackground(ticket: Ticket) {
    const tmuxName = tmuxSessionName(ticket.key);

    setStartingTickets(prev => new Set(prev).add(ticket.key));

    // Kill any stale tmux session so conductord creates a fresh one
    try {
      await window.electronAPI.conductordKillTmuxSession(tmuxName);
    } catch { /* session may not exist */ }

    // Kill stale WebSocket in the terminal bridge
    await killTerminal(tmuxName);

    let cwd: string;
    try {
      const result = await resolveWorktree(ticket);
      cwd = result.cwd;
    } catch (err) {
      console.error('[startWorkInBackground] resolveWorktree failed:', err);
      setError(`Failed to create worktree for ${ticket.key}: ${err instanceof Error ? err.message : 'unknown error'}`);
      setStartingTickets(prev => { const next = new Set(prev); next.delete(ticket.key); return next });
      return;
    }

    const claudeSettings = useConfigStore.getState().config.aiCli.claudeCode
    const skillArgs = `/conductor-start-work ${ticket.key} ${projectKey} ${connection?.providerType ?? ''} ${getDomain(connection)}`
    const escaped = skillArgs.replace(/'/g, "'\\''")
    const command = buildClaudeCommand(`claude '${escaped}'\n`, claudeSettings);

    // Start the terminal session directly via conductord without creating a tab.
    // The tmux session runs in the background and appears in the sessions sidebar.
    await createTerminal(tmuxName, cwd, command);
    setAutoPilot(tmuxName, true);

    setStartingTickets(prev => { const next = new Set(prev); next.delete(ticket.key); return next });
    setTimeout(reconcileSessions, 1500);
    // Auto-transition ticket to "In Progress"
    if (connection && provider && ticket.status === 'backlog') {
      provider.transitionTicket(connection, ticket.key, 'In Progress').catch(() => {})
    }
  }

  // Open the ticket's worktree directory in Terminal.app
  async function openInTerminal(ticket: Ticket) {
    try {
      const { cwd } = await resolveWorktree(ticket);
      // Use openExternal with a special URL that opens Terminal.app on macOS
      await window.electronAPI.openExternal(`x-apple.terminal:${cwd}`);
    } catch (err) {
      console.error('[openInTerminal] failed:', err);
      setError(`Failed to open terminal: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  // Open the ticket's worktree directory in VSCode
  async function openInVSCode(ticket: Ticket) {
    try {
      const { cwd } = await resolveWorktree(ticket);
      // VSCode registers the vscode:// URL scheme; opening a folder uses this format
      await window.electronAPI.openExternal(`vscode://file/${cwd}`);
    } catch (err) {
      console.error('[openInVSCode] failed:', err);
      setError(`Failed to open VSCode: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  // Open the ticket's worktree directory in a new Claude Code tab
  async function openInClaude(ticket: Ticket) {
    const targetGroup = focusedGroupId || groupId;
    const tmuxName = tmuxSessionName(ticket.key);
    try {
      const { cwd } = await resolveWorktree(ticket);
      addTab(targetGroup, {
        id: tmuxName,
        type: 'claude-code',
        title: `Claude · ${ticket.key}`,
        filePath: cwd,
        initialCommand: `claude\n`,
      });
      setTimeout(reconcileSessions, 1500);
    } catch (err) {
      console.error('[openInClaude] failed:', err);
      setError(`Failed to open in Claude: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  function handleEditTicket(ticket: Ticket) {
    setEditDialog({ open: true, ticket });
  }

  async function handleSaveEdit(issueKey: string, params: UpdateTicketParams) {
    if (!connection || !provider) return;
    try {
      await provider.updateTicket(connection, issueKey, params);
      // Optimistically update local state so the card reflects changes immediately
      setTickets(prev => prev.map(t => {
        if (t.key !== issueKey) return t;
        return {
          ...t,
          summary: params.summary ?? t.summary,
          priority: params.priority ?? t.priority,
        };
      }));
      // Refresh from provider to get canonical data
      loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update ticket');
    }
  }

  function handleOpenCreateDialog(
    status: TicketStatus,
    epicKey: string | null,
  ) {
    setCreateDialog({ open: true, status, epicKey });
  }

  async function handleInlineCreate(status: TicketStatus, epicKey: string | null, summary: string) {
    if (!connection || !provider) return
    try {
      await provider.createTicket(connection, {
        projectKey,
        summary,
        description: '',
        epicKey,
        status,
      })
      loadData()
    } catch (err) {
      console.error('Failed to create inline ticket:', err)
    }
  }

  async function handleCreateTicket(description: string) {
    if (!connection || !provider) return;

    const { status, epicKey } = createDialog;
    const tempId = `pending-${Date.now()}`;

    // Add skeleton
    setPendingTickets((prev) => [...prev, { tempId, status, epicKey }]);

    try {
      // Get epic summary for context
      const epic = epicKey ? epics.find((e) => e.key === epicKey) : null;

      // Use Claude CLI to generate the ticket content
      const generated = await window.electronAPI.generateTicket(
        description,
        projectKey,
        epic?.summary,
      );

      if (!generated.success) {
        throw new Error(generated.error || "Claude failed to generate ticket");
      }

      // Create the ticket via the provider
      const newTicket = await provider.createTicket(connection, {
        projectKey,
        summary: generated.summary!,
        description: generated.description!,
        issueType: generated.issueType,
        epicKey,
        status,
      });

      // Attach epic reference if available
      if (epic) newTicket.epic = epic;

      // Replace skeleton with real ticket
      setPendingTickets((prev) => prev.filter((p) => p.tempId !== tempId));
      setTickets((prev) => [...prev, newTicket]);
    } catch (err) {
      setPendingTickets((prev) => prev.filter((p) => p.tempId !== tempId));
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    }
  }

  const filteredTickets = filter
    ? tickets.filter(
        (t) =>
          t.key.toLowerCase().includes(filter.toLowerCase()) ||
          t.summary.toLowerCase().includes(filter.toLowerCase()),
      )
    : tickets;

  if (!connection) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No provider configured. Open the Kanban sidebar to connect.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-jira-surface text-zinc-300">
      {/* Board header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-jira-raised shrink-0">
        <span className="text-sm font-semibold text-zinc-100">
          {boardName}
        </span>
        <span className="rounded-full bg-jira-raised px-2 py-0.5 text-[11px] text-zinc-400">
          {tickets.length}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
            <input
              ref={filterInputRef}
              className="h-7 w-48 rounded-md bg-jira-surface border border-jira-raised pl-7 pr-2 text-xs text-zinc-200 outline-none focus:border-blue-500/50 focus:bg-jira-hovered placeholder-zinc-500 transition-colors"
              placeholder="Search board"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <button
            onClick={() => setLiveUpdate(!liveUpdate)}
            className={`flex items-center gap-1 h-7 rounded-md px-2 text-[11px] transition-colors ${
              liveUpdate
                ? 'bg-blue-600/15 text-blue-400 hover:bg-blue-600/25'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-jira-raised'
            }`}
            title={liveUpdate ? 'Auto-refresh on' : 'Enable auto-refresh'}
          >
            <Radio className={`w-3 h-3 ${liveUpdate ? 'animate-pulse' : ''}`} />
          </button>

          {/* Toggle done column visibility */}
          <button
            onClick={() => setHideDoneColumn(!hideDoneColumn)}
            className={`flex items-center gap-1 h-7 rounded-md px-2 text-[11px] transition-colors ${
              hideDoneColumn
                ? 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-jira-raised'
            }`}
            title={hideDoneColumn ? 'Show Done column' : 'Hide Done column'}
          >
            {hideDoneColumn
              ? <EyeOff className="w-3 h-3" />
              : <Eye className="w-3 h-3" />
            }
            <span>Done</span>
          </button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-300"
            onClick={loadData}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between px-4 py-2 text-xs text-red-400 bg-red-950/30 border-b border-red-900/50">
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            className="ml-2 hover:text-red-300 shrink-0"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <KanbanBoard
        tickets={filteredTickets}
        epics={epics}
        connection={connection!}
        provider={provider!}
        pendingTickets={pendingTickets}
        startingTickets={startingTickets}
        sessionThinking={sessionThinking}
        hideDoneColumn={hideDoneColumn}
        workSessions={workSessions}
        onOpenUrl={openUrl}
        onNewSession={newSession}
        onContinueSession={continueSession}
        onStartWork={startWork}
        onStartWorkInBackground={startWorkInBackground}
        onEditTicket={handleEditTicket}
        onOpenInTerminal={openInTerminal}
        onOpenInVSCode={openInVSCode}
        onOpenInClaude={openInClaude}
        onRefresh={loadData}
        onCreateTicket={handleOpenCreateDialog}
        onInlineCreate={handleInlineCreate}
      />

      <CreateTicketDialog
        open={createDialog.open}
        onOpenChange={(open) => setCreateDialog((prev) => ({ ...prev, open }))}
        columnTitle={
          createDialog.status === "backlog"
            ? "Backlog"
            : createDialog.status === "in_progress"
              ? "In Progress"
              : "Done"
        }
        onSubmit={handleCreateTicket}
      />

      <EditTicketDialog
        open={editDialog.open}
        onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}
        ticket={editDialog.ticket}
        onSubmit={handleSaveEdit}
      />
    </div>
  );
}
