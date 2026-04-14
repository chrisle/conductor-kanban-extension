import { SquareKanban } from 'lucide-react'
import type { Extension } from '@conductor/extension-sdk'
import JiraSidebar from './JiraSidebar'
import JiraBoardTab from './JiraBoardTab'
import JiraConfigPanel from './JiraConfigPanel'
import startWorkSkill from './skills/start-work/SKILL.md'

const jiraExtension: Extension = {
  id: 'jira',
  name: 'Jira',
  description: 'Browse and manage Jira boards and issues',
  version: '1.0.0',
  icon: SquareKanban,
  sidebar: JiraSidebar,
  configPanel: JiraConfigPanel,
  tabs: [
    {
      type: 'jira-board',
      label: 'Jira Board',
      icon: SquareKanban,
      component: JiraBoardTab,
    },
  ],
  skills: [
    { slug: 'start-work', content: startWorkSkill },
  ],
}

// Re-export public API for consumers
export {
  loadConfig,
  saveConfig,
  clearConfig,
  issueUrl,
  projectBoardUrl,
  fetchProjects,
  fetchTickets,
  fetchEpics,
  fetchDevelopmentInfo,
  fetchIssueTypes,
  createJiraTicket,
  updateTicket,
  transitionTicket,
  isDemoMode,
  enableDemoMode,
  disableDemoMode,
  loadDemoBoardData,
  DEMO_PROJECT_KEY,
  DEMO_PROJECT_NAME,
  DEMO_CONFIG,
} from './jira-api'
export { jiraExtension }
export default jiraExtension
export type { JiraConfig, JiraProject, Ticket, Epic, TicketStatus, PullRequest, UpdateTicketParams } from './jira-api'
