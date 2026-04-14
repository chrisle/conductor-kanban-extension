import type { Ticket, Epic, JiraConnection } from './types'

let _demoMode = false
export function isDemoMode(): boolean { return _demoMode }
export function enableDemoMode(): void { _demoMode = true }
export function disableDemoMode(): void { _demoMode = false }

export const DEMO_PROJECT_KEY = 'SD'
export const DEMO_PROJECT_NAME = 'S3 DEMO'
export const DEMO_CONFIG: JiraConnection = {
  id: 'demo',
  name: 'Demo',
  providerType: 'jira',
  domain: 'demo.atlassian.net',
  email: 'demo@example.com',
  apiToken: 'demo',
}

let _demoBoardCache: { tickets: Ticket[]; epics: Epic[] } | null = null

export async function loadDemoBoardData(): Promise<{ tickets: Ticket[]; epics: Epic[] }> {
  if (_demoBoardCache) return _demoBoardCache
  const home = await window.electronAPI.getHomeDir()
  const res = await window.electronAPI.readFile(`${home}/.conductor/demo-data/demo-board-data.json`)
  if (res.success && res.content) {
    _demoBoardCache = JSON.parse(res.content)
    return _demoBoardCache!
  }
  return { tickets: [], epics: [] }
}
