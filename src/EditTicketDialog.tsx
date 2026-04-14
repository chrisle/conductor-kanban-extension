import { useState, useEffect } from 'react'
import { ui } from '@conductor/extension-api'
import type { Ticket, UpdateTicketParams } from './jira-api'

const {
  Button, Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter, DialogDescription,
} = ui

interface EditTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticket: Ticket | null
  onSubmit: (issueKey: string, params: UpdateTicketParams) => void
}

const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest']

export function EditTicketDialog({ open, onOpenChange, ticket, onSubmit }: EditTicketDialogProps) {
  const [summary, setSummary] = useState('')
  const [priority, setPriority] = useState('')

  // Sync form state when the dialog opens with a new ticket
  useEffect(() => {
    if (open && ticket) {
      setSummary(ticket.summary)
      setPriority(ticket.priority ?? 'Medium')
    }
  }, [open, ticket])

  const handleSubmit = () => {
    if (!ticket || !summary.trim()) return
    const params: UpdateTicketParams = {}
    if (summary.trim() !== ticket.summary) params.summary = summary.trim()
    if (priority !== (ticket.priority ?? '')) params.priority = priority
    // Only submit if something changed
    if (Object.keys(params).length > 0) {
      onSubmit(ticket.key, params)
    }
    onOpenChange(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!ticket) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-900 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zinc-200">Edit {ticket.key}</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Update the ticket summary or priority.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] text-zinc-400 font-medium">Summary</label>
            <input
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 placeholder-zinc-500"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] text-zinc-400 font-medium">Priority</label>
            <select
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="text-zinc-400 hover:text-zinc-200"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="bg-blue-600 text-white hover:bg-blue-500"
            disabled={!summary.trim()}
            onClick={handleSubmit}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
