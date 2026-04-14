/**
 * Type declarations for @conductor/extension-sdk and @conductor/extension-api
 *
 * At runtime the host provides these via the extension require shim.
 * This file gives TypeScript the shapes it needs at build time.
 */

declare module '@conductor/extension-sdk' {
  import type { ComponentType } from 'react'

  export interface SkillDefinition {
    slug: string
    content: string
  }

  export interface TabProps {
    tabId: string
    groupId: string
    isActive: boolean
    tab: any
  }

  export interface TabRegistration {
    type: string
    label: string
    icon: ComponentType<{ className?: string }>
    iconClassName?: string
    component: ComponentType<TabProps>
    fileExtensions?: string[]
  }

  export interface NewTabMenuItem {
    label: string
    icon: ComponentType<{ className?: string }>
    iconClassName?: string
    action: (groupId: string) => void
    separator?: 'before' | 'after'
  }

  export interface Extension {
    id: string
    name: string
    description?: string
    version?: string
    icon?: ComponentType<{ className?: string }>
    sidebar?: ComponentType<{ groupId: string }>
    tabs?: TabRegistration[]
    newTabMenuItems?: NewTabMenuItem[]
    settingsPanel?: ComponentType<Record<string, never>>
    configPanel?: ComponentType
    onActivate?: () => void
    skills?: SkillDefinition[]
  }
}

declare module '@conductor/extension-api' {
  import type { ComponentType, FC, ReactNode } from 'react'

  // ── Stores ──────────────────────────────────────────────────────────────
  export const useTabsStore: any
  export const useLayoutStore: any
  export const useSidebarStore: any
  export const useConfigStore: any
  export const useProjectStore: any
  export const useWorkSessionsStore: any

  // ── UI Components ───────────────────────────────────────────────────────
  export const ui: {
    Button: ComponentType<any>
    Badge: ComponentType<any>
    Skeleton: ComponentType<any>
    Dialog: ComponentType<any>
    DialogContent: ComponentType<any>
    DialogHeader: ComponentType<any>
    DialogTitle: ComponentType<any>
    DialogFooter: ComponentType<any>
    DialogDescription: ComponentType<any>
    ContextMenu: ComponentType<any>
    ContextMenuTrigger: ComponentType<any>
    ContextMenuContent: ComponentType<any>
    ContextMenuItem: ComponentType<any>
    ContextMenuSeparator: ComponentType<any>
    ContextMenuSub: ComponentType<any>
    ContextMenuSubTrigger: ComponentType<any>
    ContextMenuSubContent: ComponentType<any>
    DropdownMenu: ComponentType<any>
    DropdownMenuTrigger: ComponentType<any>
    DropdownMenuContent: ComponentType<any>
    DropdownMenuItem: ComponentType<any>
    DropdownMenuSeparator: ComponentType<any>
    Collapsible: ComponentType<any>
    CollapsibleTrigger: ComponentType<any>
    CollapsibleContent: ComponentType<any>
    LinkContextMenu: ComponentType<any>
    ClaudeIcon: ComponentType<any>
    SidebarLayout: ComponentType<any>
    VisuallyHidden: ComponentType<any>
  }

  // ── Utilities ───────────────────────────────────────────────────────────
  export function cn(...args: any[]): string
  export function buildClaudeCommand(
    command: string,
    settings: { allowYoloMode: boolean; yoloModeByDefault: boolean; disableBackgroundTasks: boolean; agentTeams: boolean },
    apiKey?: string,
  ): string
  export function createTerminal(id: string, cwd?: string, command?: string): Promise<{ isNew: boolean; autoPilot?: boolean }>
  export function killTerminal(id: string): Promise<void>
  export function setAutoPilot(id: string, enabled: boolean): void

  export interface ThinkingState {
    thinking: boolean
    time?: number
    done?: boolean
  }
  export function getThinkingState(text: string): ThinkingState
  export function stripAnsi(text: string): string
}

declare module '*.md' {
  const content: string
  export default content
}
