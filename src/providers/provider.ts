import type {
  ProviderType, ProviderConnection, Ticket, Epic, Project,
  PullRequest, CreateTicketParams, UpdateTicketParams,
} from '../types'

export interface Provider {
  type: ProviderType
  displayName: string
  supportsDelete: boolean

  testConnection(connection: ProviderConnection): Promise<void>
  fetchProjects(connection: ProviderConnection): Promise<Project[]>
  projectBoardUrl(connection: ProviderConnection, project: Project): string

  fetchTickets(connection: ProviderConnection, projectKey: string): Promise<Ticket[]>
  fetchEpics(connection: ProviderConnection, projectKey: string): Promise<Epic[]>
  fetchDevelopmentInfo(connection: ProviderConnection, issueKey: string): Promise<PullRequest[]>

  createTicket(connection: ProviderConnection, params: CreateTicketParams): Promise<Ticket>
  updateTicket(connection: ProviderConnection, issueKey: string, params: UpdateTicketParams): Promise<void>
  transitionTicket(connection: ProviderConnection, issueKey: string, targetStatus: string): Promise<void>
  deleteTicket(connection: ProviderConnection, issueKey: string): Promise<void>

  issueUrl(connection: ProviderConnection, key: string): string
}

class ProviderRegistry {
  private providers = new Map<ProviderType, Provider>()

  register(provider: Provider): void {
    this.providers.set(provider.type, provider)
  }

  get(type: ProviderType): Provider {
    const p = this.providers.get(type)
    if (!p) throw new Error(`No provider registered for type: ${type}`)
    return p
  }

  getForConnection(connection: ProviderConnection): Provider {
    return this.get(connection.providerType)
  }
}

export const providerRegistry = new ProviderRegistry()
