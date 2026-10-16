export type PriorityKey = 'P0' | 'P1' | 'P2' | 'P3'
export type BoardStatus = 'proposal' | 'open' | 'active' | 'done' | 'closed'
export type CommandName = 'take' | 'drop' | 'done' | 'reopen' | 'approve' | 'reject' | 'priority' | 'due'

export interface Command {
  name: CommandName
  arg: string
}

export interface BodyFields {
  description: string
  priority: PriorityKey | null
  due: string | null
  hasPriority: boolean
}

type LabelLike = string | { name?: string } | null | undefined

export const JOB_LABEL: 'job'
export const PROPOSAL_LABEL: 'proposal'
export const DEFAULT_PRIORITY: PriorityKey
export const PRIORITIES: { key: PriorityKey; name: string; color: string; description: string }[]
export const BOARD_LABELS: { name: string; color: string; description: string }[]

export function priorityName(key: PriorityKey): string
export function priorityLabel(key: PriorityKey): string
export function parsePriority(text: string | null | undefined): PriorityKey | null
export function labelNames(labels: LabelLike[] | null | undefined): string[]
export function hasLabel(labels: LabelLike[] | null | undefined, name: string): boolean
export function priorityFromLabels(labels: LabelLike[] | null | undefined): PriorityKey | null
export function isPriorityLabel(name: string): boolean
export function parseDue(text: string | null | undefined, today?: Date): string | null
export function parseBody(body: string | null | undefined): BodyFields
export function formatBody(fields?: { description?: string; priority?: PriorityKey | null; due?: string | null }): string
export function updateBody(
  body: string | null | undefined,
  patch: { description?: string; priority?: PriorityKey | null; due?: string | null },
): string
export function parseCommands(text: string | null | undefined): Command[]
export function stripCommands(text: string | null | undefined): string
export function isCommandOnly(text: string | null | undefined): boolean
export function mentionedUser(arg: string | null | undefined): string | null
export function boardStatus(issue: {
  state: string
  state_reason?: string | null
  labels?: LabelLike[]
  assignees?: unknown[] | null
}): BoardStatus
