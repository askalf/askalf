import type { HubTab } from '../stores/hub';

export interface TabItem {
  key: HubTab;
  label: string;
}

export interface TabSection {
  label: string;
  tabs: TabItem[];
}

export const USER_TAB_SECTIONS: TabSection[] = [
  {
    label: 'Orcastr8r',
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'executions', label: 'Executions' },
      { key: 'leaderboard', label: 'Leaderboard' },
    ],
  },
];

export const ADMIN_TAB_SECTIONS: TabSection[] = [
  {
    label: 'Fleet',
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'fleet', label: 'Agents' },
      { key: 'executions', label: 'Executions' },
      { key: 'threads', label: 'Scheduler' },
    ],
  },
  {
    label: 'Ops',
    tabs: [
      { key: 'interventions', label: 'Interventions' },
      { key: 'checkpoints', label: 'Checkpoints' },
      { key: 'tickets', label: 'Tickets' },
      { key: 'deployments', label: 'Deployments' },
      { key: 'content', label: 'Content' },
      { key: 'documents', label: 'Documents' },
      { key: 'memory', label: 'Memory' },
    ],
  },
  {
    label: 'Observe',
    tabs: [
      { key: 'costs', label: 'Costs' },
      { key: 'performance', label: 'Performance' },
      { key: 'providers', label: 'Providers' },
      { key: 'guardrails', label: 'Guardrails' },
      { key: 'audit', label: 'Audit' },
    ],
  },
  {
    label: 'Build',
    tabs: [
      { key: 'workflows', label: 'Workflows' },
      { key: 'push', label: 'Push' },
    ],
  },
  {
    label: 'Intelligence',
    tabs: [
      { key: 'prompt-lab', label: 'Prompt Lab' },
      { key: 'nl-orchestrate', label: 'Orchestrate' },
      { key: 'agent-chat', label: 'Chat' },
      { key: 'goals', label: 'Goals' },
      { key: 'cost-optimizer', label: 'Optimizer' },
    ],
  },
  {
    label: 'Evolve',
    tabs: [
      { key: 'metabolic', label: 'Metabolic' },
      { key: 'knowledge', label: 'Knowledge' },
      { key: 'health', label: 'Health' },
      { key: 'evolution', label: 'Evolution' },
      { key: 'events', label: 'Events' },
      { key: 'leaderboard', label: 'Leaderboard' },
    ],
  },
];
