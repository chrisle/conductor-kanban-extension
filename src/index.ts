import { SquareKanban } from 'lucide-react'
import type { Extension } from '@conductor/extension-sdk'
import Sidebar from './Sidebar'
import BoardTab from './BoardTab'
import ConfigPanel from './ConfigPanel'
import startWorkSkill from './skills/start-work/SKILL.md'

// Register providers
import './providers/jira/jira-provider'
import './providers/gitea/gitea-provider'
import './providers/azure-devops/azure-devops-provider'
import './providers/github-projects/github-projects-provider'

const kanbanExtension: Extension = {
  id: 'kanban',
  name: 'Kanban',
  description: 'Browse and manage project boards and issues from Jira, GitHub Projects, Gitea, and more',
  version: '2.1.0',
  icon: SquareKanban,
  sidebar: Sidebar,
  configPanel: ConfigPanel,
  tabs: [
    {
      type: 'kanban-board',
      label: 'Board',
      icon: SquareKanban,
      component: BoardTab,
    },
  ],
  skills: [
    { slug: 'start-work', content: startWorkSkill },
  ],
}

export { kanbanExtension }
export default kanbanExtension
export { providerRegistry } from './providers/provider'
export type {
  Ticket, Epic, PullRequest, TicketStatus, UpdateTicketParams,
  CreateTicketParams, Project, ProviderConnection, ProviderType,
  AzureDevOpsConnection, GitHubProjectsConnection,
} from './types'
