export type ProviderType = 'jira' | 'gitea' | 'azure-devops' | 'github-projects'

export type TicketStatus = 'backlog' | 'in_progress' | 'done'

export interface Ticket {
  key: string
  summary: string
  description?: string
  status: TicketStatus
  providerStatus: string
  issueType: string
  priority: string | null
  storyPoints: number | null
  epicKey: string | null
  updatedAt: string
  pullRequests: PullRequest[]
  epic?: Epic
}

export interface Epic {
  key: string
  summary: string
  status: string | null
}

export interface PullRequest {
  id: string
  url: string
  name: string
  status: string
}

export interface Project {
  id: string
  key: string
  name: string
  category?: string
  avatarUrl?: string
}

export interface UpdateTicketParams {
  summary?: string
  description?: string
  priority?: string
}

export interface CreateTicketParams {
  projectKey: string
  summary: string
  description: string
  issueType?: string
  epicKey?: string | null
  status?: TicketStatus
}

export interface ProviderConnectionBase {
  id: string
  name: string
  providerType: ProviderType
}

export interface JiraConnection extends ProviderConnectionBase {
  providerType: 'jira'
  domain: string
  email: string
  apiToken: string
}

export interface GiteaConnection extends ProviderConnectionBase {
  providerType: 'gitea'
  baseUrl: string
  token: string
  ownerFilter?: string
}

export interface AzureDevOpsConnection extends ProviderConnectionBase {
  providerType: 'azure-devops'
  orgUrl: string
  pat: string
}

export interface GitHubProjectsConnection extends ProviderConnectionBase {
  providerType: 'github-projects'
  // GitHub personal access token (classic: `project` + `repo` scopes;
  // fine-grained: Projects and Issues read/write).
  token: string
  // Optional organization or user login. When omitted, the projects owned by
  // the authenticated user are listed.
  owner?: string
}

export type ProviderConnection =
  | JiraConnection
  | GiteaConnection
  | AzureDevOpsConnection
  | GitHubProjectsConnection
