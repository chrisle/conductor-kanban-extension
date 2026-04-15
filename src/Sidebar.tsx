import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  RefreshCw,
  ChevronRight,
  Globe,
  LayoutGrid,
  Pin,
  Plus,
} from "lucide-react";
import {
  useTabsStore,
  useLayoutStore,
  useSidebarStore,
  useProjectStore,
  useConfigStore,
  ui,
} from "@conductor/extension-api";
import type {
  ProviderType,
  ProviderConnection,
  JiraConnection,
  GiteaConnection,
  Project,
} from "./types";
import { providerRegistry } from "./providers/provider";

const {
  Button, Skeleton, Dialog, DialogContent, DialogTitle, DialogFooter,
  VisuallyHidden, ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator, SidebarLayout, Collapsible,
  CollapsibleTrigger, CollapsibleContent,
} = ui;

// Module-level cache so projects survive sidebar unmount/remount
let cachedProjects: Project[] | null = null;

function ConfigForm({ onSave }: { onSave: (conn: ProviderConnection) => void }) {
  const [providerType, setProviderType] = useState<ProviderType>("jira");
  // Jira fields
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  // Gitea fields
  const [giteaUrl, setGiteaUrl] = useState("");
  const [giteaToken, setGiteaToken] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");

  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTesting(true);
    setError("");

    try {
      let connection: ProviderConnection;

      if (providerType === "jira") {
        const d = domain.trim();
        const em = email.trim();
        const tok = apiToken.trim();
        if (!d || !em || !tok) {
          setError("All fields are required");
          setTesting(false);
          return;
        }
        connection = {
          id: crypto.randomUUID(),
          name: d,
          providerType: "jira",
          domain: d,
          email: em,
          apiToken: tok,
        } satisfies JiraConnection;
      } else {
        const url = giteaUrl.trim();
        const tok = giteaToken.trim();
        if (!url || !tok) {
          setError("URL and token are required");
          setTesting(false);
          return;
        }
        connection = {
          id: crypto.randomUUID(),
          name: url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
          providerType: "gitea",
          baseUrl: url,
          token: tok,
          ownerFilter: ownerFilter.trim() || undefined,
        } satisfies GiteaConnection;
      }

      const provider = providerRegistry.get(connection.providerType);
      await provider.testConnection(connection);
      await useConfigStore.getState().addProviderConnection(connection);
      onSave(connection);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  const inputClass =
    "w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500 placeholder-zinc-500";

  return (
    <form onSubmit={handleSubmit} className="px-3 py-3 space-y-3">
      <div className="text-xs text-zinc-400">Connect to your project tracker</div>

      {/* Provider type selector */}
      <div className="space-y-1.5">
        <label className="text-[11px] text-zinc-400 font-medium">Provider</label>
        <select
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          value={providerType}
          onChange={(e) => setProviderType(e.target.value as ProviderType)}
        >
          <option value="jira">Jira</option>
          <option value="gitea">Gitea</option>
        </select>
      </div>

      {providerType === "jira" ? (
        <>
          <input
            className={inputClass}
            placeholder="Domain (e.g. mycompany)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            className={inputClass}
            placeholder="API Token"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
          />
        </>
      ) : (
        <>
          <input
            className={inputClass}
            placeholder="Gitea URL (e.g. https://gitea.example.com)"
            value={giteaUrl}
            onChange={(e) => setGiteaUrl(e.target.value)}
          />
          <input
            type="password"
            className={inputClass}
            placeholder="Access Token"
            value={giteaToken}
            onChange={(e) => setGiteaToken(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Owner filter (optional)"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
          />
        </>
      )}

      {error && <div className="text-[11px] text-red-400">{error}</div>}
      <button
        type="submit"
        disabled={testing}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded py-1.5 transition-colors"
      >
        {testing ? "Connecting..." : "Connect"}
      </button>

      {providerType === "jira" && (
        <div className="text-[10px] text-zinc-500 leading-relaxed">
          Create an API token at{" "}
          <span className="text-zinc-400">
            id.atlassian.com/manage-profile/security/api-tokens
          </span>
        </div>
      )}
    </form>
  );
}

export default function Sidebar({
  groupId,
}: {
  groupId: string;
}): React.ReactElement {
  const [connection, setConnection] = useState<ProviderConnection | null>(() =>
    useConfigStore.getState().getActiveConnection(),
  );
  // Re-derive connection when the config store finishes loading (async IPC)
  const configReady = useConfigStore((s) => s.ready);
  useEffect(() => {
    if (configReady && !connection) {
      const loaded = useConfigStore.getState().getActiveConnection();
      if (loaded) setConnection(loaded);
    }
  }, [configReady]);

  const provider = connection
    ? providerRegistry.get(connection.providerType)
    : null;

  const [projects, setProjects] = useState<Project[]>(cachedProjects || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const [settingsTesting, setSettingsTesting] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const { addTab, setActiveTab, groups } = useTabsStore();
  const { focusedGroupId } = useLayoutStore();
  const { rootPath } = useSidebarStore();
  const filterRef = useRef<HTMLInputElement>(null);

  const loadProjects = useCallback(
    async (force = false) => {
      if (!connection || !provider) return;
      if (!force && cachedProjects) return;
      setLoading(true);
      setError("");
      try {
        const result = await provider.fetchProjects(connection);
        cachedProjects = result;
        setProjects(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [connection, provider],
  );

  useEffect(() => {
    if (connection) loadProjects();
  }, [connection, loadProjects]);

  function openBoard(project: Project, forceNew = false) {
    if (!connection) return;
    const targetGroup = focusedGroupId || groupId;

    // Focus existing tab if one is already open for this project
    if (!forceNew) {
      const group = groups[targetGroup];
      if (group) {
        const existing = group.tabs.find(
          (t) => t.type === "kanban-board" && t.content === project.key,
        );
        if (existing) {
          setActiveTab(targetGroup, existing.id);
          return;
        }
      }
    }

    addTab(targetGroup, {
      type: "kanban-board",
      title: `${project.name} Kanban Board`,
      content: project.key,
    });
  }

  function openInConductorBrowser(project: Project) {
    if (!connection || !provider) return;
    const url = provider.projectBoardUrl(connection, project);
    const targetGroup = focusedGroupId || groupId;
    addTab(targetGroup, {
      type: "browser",
      title: `${project.key} - ${provider.displayName}`,
      url,
    });
  }

  function handleOpenSettings() {
    if (!connection) return;
    if (connection.providerType === "jira") {
      setSettingsForm({
        domain: connection.domain,
        email: connection.email,
        apiToken: connection.apiToken,
      });
    } else {
      setSettingsForm({
        baseUrl: connection.baseUrl,
        token: connection.token,
        ownerFilter: connection.ownerFilter || "",
      });
    }
    setSettingsError("");
    setSettingsOpen(true);
  }

  async function handleSaveSettings() {
    if (!connection) return;

    setSettingsTesting(true);
    setSettingsError("");

    try {
      let newConnection: ProviderConnection;

      if (connection.providerType === "jira") {
        const d = (settingsForm.domain || "").trim();
        const em = (settingsForm.email || "").trim();
        const tok = (settingsForm.apiToken || "").trim();
        if (!d || !em || !tok) {
          setSettingsError("All fields are required");
          setSettingsTesting(false);
          return;
        }
        newConnection = {
          ...connection,
          domain: d,
          email: em,
          apiToken: tok,
          name: d,
        };
      } else {
        const url = (settingsForm.baseUrl || "").trim();
        const tok = (settingsForm.token || "").trim();
        if (!url || !tok) {
          setSettingsError("URL and token are required");
          setSettingsTesting(false);
          return;
        }
        newConnection = {
          ...connection,
          baseUrl: url,
          token: tok,
          ownerFilter: (settingsForm.ownerFilter || "").trim() || undefined,
          name: url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
        };
      }

      const p = providerRegistry.get(newConnection.providerType);
      await p.fetchProjects(newConnection);
      // Remove old, add updated connection
      await useConfigStore.getState().removeProviderConnection(connection.id);
      await useConfigStore.getState().addProviderConnection(newConnection);
      cachedProjects = null;
      setConnection(newConnection);
      setSettingsOpen(false);
      loadProjects(true);
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : "Connection failed",
      );
    } finally {
      setSettingsTesting(false);
    }
  }

  const providerProjectKeys = useProjectStore((s) => s.providerProjectKeys);
  const hasLinkedSpaces = providerProjectKeys.length > 0;

  function handleLogout() {
    if (connection) {
      useConfigStore.getState().removeProviderConnection(connection.id);
    }
    cachedProjects = null;
    setProjects([]);
    setConnection(null);
    setSettingsOpen(false);
  }

  const displayName = provider?.displayName ?? connection?.name ?? "Kanban";

  if (!connection) {
    return (
      <SidebarLayout
        title="Kanban"
        actions={[]}
      >
        <ConfigForm onSave={setConnection} />
      </SidebarLayout>
    );
  }

  const filtered = filter
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(filter.toLowerCase()) ||
          p.key.toLowerCase().includes(filter.toLowerCase()),
      )
    : projects;

  // Linked projects (pinned at top when project has providerProjectKeys)
  const linkedProjects = hasLinkedSpaces
    ? projects.filter((p) => providerProjectKeys.includes(p.key))
    : [];

  // Remaining projects (exclude linked when filtering is off)
  const remainingFiltered =
    hasLinkedSpaces && !filter
      ? filtered.filter((p) => !providerProjectKeys.includes(p.key))
      : filtered;

  // Group by category
  const grouped = new Map<string, Project[]>();
  for (const p of remainingFiltered) {
    const type = p.category || "other";
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type)!.push(p);
  }

  const typeLabels: Record<string, string> = {
    software: "Software",
    service_desk: "Service Desk",
    business: "Business",
    other: "Projects",
  };

  // Domain / base URL display
  function connectionLabel(): string {
    if (!connection) return "";
    if (connection.providerType === "jira") {
      return connection.domain.replace(/\.atlassian\.net$/, "") + ".atlassian.net";
    }
    return connection.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  return (
    <SidebarLayout
      title={displayName}
      actions={[
        {
          icon: RefreshCw,
          label: "Refresh",
          onClick: () => loadProjects(true),
          disabled: loading,
          spinning: loading,
        },
      ]}
      onSettings={handleOpenSettings}
      footer="v0.1.0"
    >
      {/* Connection info */}
      <div className="px-3 py-1.5 text-[11px] text-zinc-500 border-b border-zinc-700/40">
        {connectionLabel()}
      </div>

      {/* Filter */}
      {projects.length > 5 && (
        <div className="px-3 py-1.5 border-b border-zinc-700/40">
          <input
            ref={filterRef}
            className="w-full bg-zinc-800/50 border border-zinc-600/50 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500/60 placeholder-zinc-500"
            placeholder="Filter projects..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      {/* Project list */}
      {error && (
        <div className="flex items-center justify-between px-3 py-2 text-[11px] text-red-400 bg-red-950/30">
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            className="ml-2 hover:text-red-300"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {loading && projects.length === 0 && (
        <div className="px-3 py-2 space-y-1">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5">
              <Skeleton className="h-4 w-4 rounded-sm shrink-0" />
              <Skeleton
                className="h-3.5"
                style={{ width: `${40 + ((i * 15) % 40)}%` }}
              />
              <Skeleton className="h-3 w-8 ml-auto shrink-0" />
            </div>
          ))}
        </div>
      )}

      {!loading && projects.length === 0 && !error && (
        <div className="px-3 py-4 text-xs text-zinc-500">
          No projects found
        </div>
      )}

      {/* Linked spaces (pinned at top) */}
      {linkedProjects.length > 0 && (
        <div className="mb-1">
          <div className="px-3 py-1.5 flex items-center gap-1">
            <Pin className="w-3 h-3 text-blue-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-400">
              Linked
            </span>
          </div>
          {linkedProjects.map((project) => (
            <button
              key={project.id}
              onClick={() => openBoard(project)}
              className="w-full text-left px-3 py-1.5 pl-7 hover:bg-zinc-800/50 transition-colors group"
            >
              <div className="flex items-center gap-2">
                {project.avatarUrl && (
                  <img
                    src={project.avatarUrl}
                    alt=""
                    className="w-4 h-4 rounded-sm shrink-0"
                  />
                )}
                <span className="text-xs text-zinc-300 group-hover:text-zinc-100 truncate">
                  {project.name}
                </span>
                <span className="text-[10px] text-zinc-500 shrink-0 ml-auto">
                  {project.key}
                </span>
              </div>
            </button>
          ))}
          <div className="border-t border-zinc-800/60 mt-1" />
        </div>
      )}

      {/* All projects (collapsed when linked spaces exist) */}
      {hasLinkedSpaces ? (
        <Collapsible defaultOpen={!hasLinkedSpaces}>
          <CollapsibleTrigger className="w-full flex items-center gap-1 px-3 py-1.5 text-left hover:bg-zinc-800/30 transition-colors">
            <ChevronRight className="w-3 h-3 text-zinc-500 transition-transform data-[state=open]:rotate-90" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              All Projects
            </span>
            <span className="text-[10px] text-zinc-500 ml-auto">
              {remainingFiltered.length}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {[...grouped.entries()].map(([type, typeProjects]) => (
              <ProjectGroup
                key={type}
                label={typeLabels[type] || type}
                projects={typeProjects}
                providerDisplayName={provider?.displayName ?? "Board"}
                onOpen={openBoard}
                onOpenInConductor={openInConductorBrowser}
                onOpenInSystemBrowser={openInConductorBrowser}
                onOpenNewTab={(p) => openBoard(p, true)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : (
        [...grouped.entries()].map(([type, typeProjects]) => (
          <ProjectGroup
            key={type}
            label={typeLabels[type] || type}
            projects={typeProjects}
            providerDisplayName={provider?.displayName ?? "Board"}
            onOpen={openBoard}
            onOpenInConductor={openInConductorBrowser}
            onOpenInSystemBrowser={openInConductorBrowser}
            onOpenNewTab={(p) => openBoard(p, true)}
          />
        ))
      )}

      {/* Settings dialog */}
      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => !open && setSettingsOpen(false)}
      >
        <DialogContent
          className="bg-zinc-900 border-zinc-700 max-w-sm"
          hideClose
        >
          <VisuallyHidden>
            <DialogTitle>{displayName} Settings</DialogTitle>
          </VisuallyHidden>
          <div className="space-y-3">
            <div className="text-sm text-zinc-300 font-medium">
              {displayName} Settings
            </div>
            {connection?.providerType === "jira" ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-zinc-400 font-medium">
                    Domain
                  </label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
                    placeholder="e.g. mycompany"
                    value={settingsForm.domain || ""}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, domain: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-zinc-400 font-medium">
                    Email
                  </label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
                    placeholder="you@example.com"
                    value={settingsForm.email || ""}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, email: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-zinc-400 font-medium">
                    API Token
                  </label>
                  <input
                    type="password"
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
                    placeholder="API token"
                    value={settingsForm.apiToken || ""}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        apiToken: e.target.value,
                      }))
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-zinc-400 font-medium">
                    URL
                  </label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
                    placeholder="https://gitea.example.com"
                    value={settingsForm.baseUrl || ""}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        baseUrl: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-zinc-400 font-medium">
                    Access Token
                  </label>
                  <input
                    type="password"
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
                    placeholder="Access token"
                    value={settingsForm.token || ""}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        token: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-zinc-400 font-medium">
                    Owner Filter
                  </label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
                    placeholder="Optional owner/org filter"
                    value={settingsForm.ownerFilter || ""}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        ownerFilter: e.target.value,
                      }))
                    }
                  />
                </div>
              </>
            )}
            {settingsError && (
              <div className="text-[11px] text-red-400">{settingsError}</div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="text-xs text-red-400 hover:text-red-300 mr-auto"
              onClick={handleLogout}
            >
              Log out
            </Button>
            <Button
              variant="ghost"
              className="text-xs text-zinc-400 hover:text-zinc-200"
              onClick={() => setSettingsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="text-xs bg-blue-600 hover:bg-blue-500 text-white"
              onClick={handleSaveSettings}
              disabled={settingsTesting}
            >
              {settingsTesting ? "Testing..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarLayout>
  );
}

function ProjectGroup({
  label,
  projects,
  providerDisplayName,
  onOpen,
  onOpenInConductor,
  onOpenInSystemBrowser,
  onOpenNewTab,
}: {
  label: string;
  projects: Project[];
  providerDisplayName: string;
  onOpen: (p: Project) => void;
  onOpenInConductor: (p: Project) => void;
  onOpenInSystemBrowser: (p: Project) => void;
  onOpenNewTab: (p: Project) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        className="w-full flex items-center gap-1 px-3 py-1.5 text-left hover:bg-zinc-800/30 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronRight
          className={`w-3 h-3 text-zinc-500 transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          {label}
        </span>
        <span className="text-[10px] text-zinc-500 ml-auto">
          {projects.length}
        </span>
      </button>
      {!collapsed &&
        projects.map((project) => (
          <ContextMenu key={project.id}>
            <ContextMenuTrigger asChild>
              <button
                onClick={() => onOpen(project)}
                className="w-full text-left px-3 py-1.5 pl-7 hover:bg-zinc-800/50 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  {project.avatarUrl && (
                    <img
                      src={project.avatarUrl}
                      alt=""
                      className="w-4 h-4 rounded-sm shrink-0"
                    />
                  )}
                  <span className="text-xs text-zinc-300 group-hover:text-zinc-100 truncate">
                    {project.name}
                  </span>
                  <span className="text-[10px] text-zinc-500 shrink-0 ml-auto">
                    {project.key}
                  </span>
                </div>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="bg-zinc-900/80 backdrop-blur-xl border-zinc-700 min-w-[140px]">
              <ContextMenuItem
                className="text-xs text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100"
                onClick={() => onOpenInConductor(project)}
              >
                <Globe className="w-3.5 h-3.5 mr-2" />
                Go to Kanban Board
              </ContextMenuItem>
              <ContextMenuItem
                className="text-xs text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100"
                onClick={() => onOpenInSystemBrowser(project)}
              >
                <Globe className="w-3.5 h-3.5 mr-2" />
                Open {providerDisplayName}
              </ContextMenuItem>
              <ContextMenuSeparator className="bg-zinc-700" />
              <ContextMenuItem
                className="text-xs text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100"
                onClick={() => onOpenNewTab(project)}
              >
                <Plus className="w-3.5 h-3.5 mr-2" />
                Open in New Tab
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
    </div>
  );
}
