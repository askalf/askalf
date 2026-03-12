import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import { relativeTime } from '../../utils/format';
import type { Workflow, WorkflowNode, WorkflowEdge } from '../../hooks/useHubApi';
import Modal from '../hub/shared/Modal';
import StatusBadge from '../hub/shared/StatusBadge';
import './forge-workflow.css';

/* ─── Node Type Registry ─── */
const NODE_TYPES: Record<string, { icon: string; color: string; bg: string; label: string; desc: string }> = {
  input:            { icon: '→', color: '#10b981', bg: 'rgba(16,185,129,0.12)',  label: 'Input',      desc: 'Workflow entry point' },
  output:           { icon: '←', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: 'Output',     desc: 'Collect final result' },
  agent:            { icon: '⚡', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', label: 'Agent',      desc: 'Run an agent with a prompt' },
  condition:        { icon: '◇', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Condition',  desc: 'Branch based on expression' },
  parallel:         { icon: '⫘', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', label: 'Parallel',   desc: 'Run nodes concurrently' },
  merge:            { icon: '⫗', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',  label: 'Merge',      desc: 'Combine branch outputs' },
  transform:        { icon: '↹', color: '#6b7280', bg: 'rgba(107,114,128,0.12)',label: 'Transform',  desc: 'Reshape data between steps' },
  human_checkpoint: { icon: '⏸', color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'Checkpoint', desc: 'Pause for human approval' },
};

const NODE_TYPE_KEYS = Object.keys(NODE_TYPES);

/* ─── Workflow Templates (pre-built DAGs) ─── */
interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'tpl-research-pipeline',
    name: 'Research Pipeline',
    description: 'Gather research, analyze findings, and produce a structured report with human review.',
    category: 'research',
    icon: '🔍',
    color: '#8b5cf6',
    nodes: [
      { id: 'input-1', type: 'input', label: 'Research Query' },
      { id: 'agent-researcher', type: 'agent', label: 'Researcher', config: { prompt: 'Research the given topic thoroughly. Gather key facts, sources, and data points.\n\nTopic: {{__input}}' } },
      { id: 'agent-analyst', type: 'agent', label: 'Analyst', config: { prompt: 'Analyze the research findings. Identify patterns, insights, and actionable conclusions.\n\nResearch: {{agent-researcher}}' } },
      { id: 'checkpoint-review', type: 'human_checkpoint', label: 'Review Findings', config: { checkpointType: 'review', title: 'Review research analysis', description: 'Verify the analysis is accurate and complete before generating the final report.' } },
      { id: 'agent-writer', type: 'agent', label: 'Report Writer', config: { prompt: 'Write a clear, structured report based on the research and analysis.\n\nAnalysis: {{agent-analyst}}' } },
      { id: 'output-1', type: 'output', label: 'Final Report', config: { source: 'agent-writer' } },
    ],
    edges: [
      { from: 'input-1', to: 'agent-researcher' },
      { from: 'agent-researcher', to: 'agent-analyst' },
      { from: 'agent-analyst', to: 'checkpoint-review' },
      { from: 'checkpoint-review', to: 'agent-writer' },
      { from: 'agent-writer', to: 'output-1' },
    ],
  },
  {
    id: 'tpl-code-review',
    name: 'Parallel Code Review',
    description: 'Run frontend, backend, and security reviews concurrently, merge results, then get human approval.',
    category: 'build',
    icon: '🔀',
    color: '#3b82f6',
    nodes: [
      { id: 'input-1', type: 'input', label: 'Code Changes' },
      { id: 'parallel-reviews', type: 'parallel', label: 'Parallel Reviews', config: { nodeIds: ['agent-frontend', 'agent-backend', 'agent-security'] } },
      { id: 'agent-frontend', type: 'agent', label: 'Frontend Review', config: { prompt: 'Review the code changes for frontend quality: component structure, accessibility, styling, and UX patterns.\n\nChanges: {{__input}}' } },
      { id: 'agent-backend', type: 'agent', label: 'Backend Review', config: { prompt: 'Review the code changes for backend quality: API design, error handling, performance, and security.\n\nChanges: {{__input}}' } },
      { id: 'agent-security', type: 'agent', label: 'Security Review', config: { prompt: 'Review the code changes for security vulnerabilities: injection risks, auth issues, data exposure, OWASP top 10.\n\nChanges: {{__input}}' } },
      { id: 'merge-results', type: 'merge', label: 'Merge Reviews', config: { sources: ['agent-frontend', 'agent-backend', 'agent-security'] } },
      { id: 'checkpoint-approve', type: 'human_checkpoint', label: 'Approve Reviews', config: { checkpointType: 'approval', title: 'Approve code review results', description: 'Review all findings from the parallel code reviews before finalizing.' } },
      { id: 'output-1', type: 'output', label: 'Review Report', config: { source: 'merge-results' } },
    ],
    edges: [
      { from: 'input-1', to: 'parallel-reviews' },
      { from: 'parallel-reviews', to: 'agent-frontend' },
      { from: 'parallel-reviews', to: 'agent-backend' },
      { from: 'parallel-reviews', to: 'agent-security' },
      { from: 'agent-frontend', to: 'merge-results' },
      { from: 'agent-backend', to: 'merge-results' },
      { from: 'agent-security', to: 'merge-results' },
      { from: 'merge-results', to: 'checkpoint-approve' },
      { from: 'checkpoint-approve', to: 'output-1' },
    ],
  },
  {
    id: 'tpl-content-pipeline',
    name: 'Content Pipeline',
    description: 'Research a topic, draft content, review and edit, then publish.',
    category: 'content',
    icon: '✍️',
    color: '#10b981',
    nodes: [
      { id: 'input-1', type: 'input', label: 'Content Brief' },
      { id: 'agent-research', type: 'agent', label: 'Topic Research', config: { prompt: 'Research the topic for content creation. Gather key facts, quotes, statistics, and relevant context.\n\nBrief: {{__input}}' } },
      { id: 'agent-draft', type: 'agent', label: 'Content Writer', config: { prompt: 'Write compelling, well-structured content based on the research.\n\nResearch: {{agent-research}}\nBrief: {{__input}}' } },
      { id: 'checkpoint-edit', type: 'human_checkpoint', label: 'Editorial Review', config: { checkpointType: 'review', title: 'Review draft content', description: 'Edit the draft for accuracy, tone, and quality before publishing.' } },
      { id: 'agent-polish', type: 'agent', label: 'Final Polish', config: { prompt: 'Apply final edits and polish the content. Fix grammar, improve flow, and ensure consistency.\n\nDraft: {{agent-draft}}' } },
      { id: 'output-1', type: 'output', label: 'Published Content', config: { source: 'agent-polish' } },
    ],
    edges: [
      { from: 'input-1', to: 'agent-research' },
      { from: 'agent-research', to: 'agent-draft' },
      { from: 'agent-draft', to: 'checkpoint-edit' },
      { from: 'checkpoint-edit', to: 'agent-polish' },
      { from: 'agent-polish', to: 'output-1' },
    ],
  },
  {
    id: 'tpl-monitored-deploy',
    name: 'Monitored Deploy',
    description: 'Build, test, get approval, deploy, then verify with conditional rollback.',
    category: 'devops',
    icon: '🚀',
    color: '#f97316',
    nodes: [
      { id: 'input-1', type: 'input', label: 'Deploy Request' },
      { id: 'agent-build', type: 'agent', label: 'Build & Test', config: { prompt: 'Build the project and run the test suite. Report build status, test results, and any warnings.\n\nRequest: {{__input}}' } },
      { id: 'condition-tests', type: 'condition', label: 'Tests Pass?', config: { expression: 'agent-build.status == "success"' } },
      { id: 'checkpoint-approve', type: 'human_checkpoint', label: 'Deploy Approval', config: { checkpointType: 'approval', title: 'Approve deployment', description: 'Build and tests passed. Approve to proceed with deployment.', timeoutMinutes: 30 } },
      { id: 'agent-deploy', type: 'agent', label: 'Deploy', config: { prompt: 'Execute the deployment. Deploy the built artifacts to the target environment.\n\nBuild: {{agent-build}}' } },
      { id: 'agent-verify', type: 'agent', label: 'Verify Deploy', config: { prompt: 'Verify the deployment is healthy. Run smoke tests, check endpoints, and validate the deployment.\n\nDeploy: {{agent-deploy}}' } },
      { id: 'output-success', type: 'output', label: 'Deploy Result', config: { source: 'agent-verify' } },
      { id: 'output-fail', type: 'output', label: 'Test Failure', config: { source: 'agent-build' } },
    ],
    edges: [
      { from: 'input-1', to: 'agent-build' },
      { from: 'agent-build', to: 'condition-tests' },
      { from: 'condition-tests', to: 'checkpoint-approve', condition: 'pass' },
      { from: 'condition-tests', to: 'output-fail', condition: 'fail' },
      { from: 'checkpoint-approve', to: 'agent-deploy' },
      { from: 'agent-deploy', to: 'agent-verify' },
      { from: 'agent-verify', to: 'output-success' },
    ],
  },
  {
    id: 'tpl-data-analysis',
    name: 'Data Analysis',
    description: 'Query data, transform and clean it, run analysis, then produce visualizable insights.',
    category: 'analyze',
    icon: '📊',
    color: '#06b6d4',
    nodes: [
      { id: 'input-1', type: 'input', label: 'Analysis Question' },
      { id: 'agent-query', type: 'agent', label: 'Data Gathering', config: { prompt: 'Gather the relevant data to answer the analysis question. Query databases, APIs, or other sources.\n\nQuestion: {{__input}}' } },
      { id: 'transform-clean', type: 'transform', label: 'Clean & Normalize', config: { mapping: { raw_data: 'agent-query.data', question: '__input' } } },
      { id: 'agent-analyze', type: 'agent', label: 'Analyze Data', config: { prompt: 'Perform statistical analysis on the cleaned data. Identify trends, correlations, outliers, and key metrics.\n\nData: {{transform-clean}}' } },
      { id: 'agent-insights', type: 'agent', label: 'Generate Insights', config: { prompt: 'Translate the analysis into clear, actionable insights with recommendations.\n\nAnalysis: {{agent-analyze}}\nOriginal question: {{__input}}' } },
      { id: 'output-1', type: 'output', label: 'Analysis Report', config: { source: 'agent-insights' } },
    ],
    edges: [
      { from: 'input-1', to: 'agent-query' },
      { from: 'agent-query', to: 'transform-clean' },
      { from: 'transform-clean', to: 'agent-analyze' },
      { from: 'agent-analyze', to: 'agent-insights' },
      { from: 'agent-insights', to: 'output-1' },
    ],
  },
  {
    id: 'tpl-security-audit',
    name: 'Security Audit',
    description: 'Parallel vulnerability scan, dependency check, and config review with severity-gated approval.',
    category: 'security',
    icon: '🛡️',
    color: '#ef4444',
    nodes: [
      { id: 'input-1', type: 'input', label: 'Audit Target' },
      { id: 'parallel-scans', type: 'parallel', label: 'Parallel Scans', config: { nodeIds: ['agent-vuln', 'agent-deps', 'agent-config'] } },
      { id: 'agent-vuln', type: 'agent', label: 'Vulnerability Scan', config: { prompt: 'Scan for security vulnerabilities: injection flaws, XSS, CSRF, auth bypasses, data exposure.\n\nTarget: {{__input}}' } },
      { id: 'agent-deps', type: 'agent', label: 'Dependency Audit', config: { prompt: 'Audit all dependencies for known CVEs, outdated packages, and supply chain risks.\n\nTarget: {{__input}}' } },
      { id: 'agent-config', type: 'agent', label: 'Config Review', config: { prompt: 'Review security configuration: TLS, CORS, CSP headers, auth settings, secrets management.\n\nTarget: {{__input}}' } },
      { id: 'merge-findings', type: 'merge', label: 'Merge Findings', config: { sources: ['agent-vuln', 'agent-deps', 'agent-config'] } },
      { id: 'condition-severity', type: 'condition', label: 'Critical Issues?', config: { expression: 'merge-findings.severity == "critical"' } },
      { id: 'checkpoint-critical', type: 'human_checkpoint', label: 'Critical Review', config: { checkpointType: 'approval', title: 'Critical vulnerabilities found', description: 'Critical security issues were detected. Review findings and decide on remediation.' } },
      { id: 'output-1', type: 'output', label: 'Audit Report', config: { source: 'merge-findings' } },
    ],
    edges: [
      { from: 'input-1', to: 'parallel-scans' },
      { from: 'parallel-scans', to: 'agent-vuln' },
      { from: 'parallel-scans', to: 'agent-deps' },
      { from: 'parallel-scans', to: 'agent-config' },
      { from: 'agent-vuln', to: 'merge-findings' },
      { from: 'agent-deps', to: 'merge-findings' },
      { from: 'agent-config', to: 'merge-findings' },
      { from: 'merge-findings', to: 'condition-severity' },
      { from: 'condition-severity', to: 'checkpoint-critical', condition: 'critical' },
      { from: 'condition-severity', to: 'output-1', condition: 'pass' },
      { from: 'checkpoint-critical', to: 'output-1' },
    ],
  },
];

const TEMPLATE_CATEGORIES = [...new Set(WORKFLOW_TEMPLATES.map(t => t.category))];


/* ─── Node Config Summary (inline preview) ─── */
function nodeConfigSummary(node: WorkflowNode): string {
  const cfg = node.config || {};
  switch (node.type) {
    case 'agent':
      return node.agentName || (node.agentId ? `Agent ${node.agentId.slice(0, 8)}...` : 'No agent assigned');
    case 'condition':
      return (cfg.expression as string) || 'No expression set';
    case 'parallel':
      return (cfg.nodeIds as string[])?.length ? `${(cfg.nodeIds as string[]).length} concurrent nodes` : 'No nodes configured';
    case 'merge':
      return (cfg.sources as string[])?.length ? `${(cfg.sources as string[]).length} sources` : 'No sources configured';
    case 'transform':
      return cfg.mapping ? `${Object.keys(cfg.mapping as object).length} mappings` : 'No mappings set';
    case 'human_checkpoint':
      return (cfg.checkpointType as string) || 'approval';
    case 'input': return 'Passes workflow input';
    case 'output': return (cfg.source as string) ? `Exports: ${cfg.source}` : 'Exports full context';
    default: return '';
  }
}

/* ─── Node Warnings ─── */
function getNodeWarnings(node: WorkflowNode, edges: WorkflowEdge[]): string[] {
  const warnings: string[] = [];
  if (node.type === 'agent' && !node.agentId) warnings.push('No agent assigned');
  if (node.type === 'condition' && !(node.config?.expression)) warnings.push('No expression set');
  const hasIncoming = edges.some(e => e.to === node.id);
  const hasOutgoing = edges.some(e => e.from === node.id);
  if (node.type !== 'input' && !hasIncoming) warnings.push('No incoming connection');
  if (node.type !== 'output' && !hasOutgoing) warnings.push('No outgoing connection');
  return warnings;
}

/* ─── Type-specific Config Editor ─── */
interface NodeEditorProps {
  node: WorkflowNode;
  onChange: (updated: WorkflowNode) => void;
  agents: Array<{ id: string; name: string; type: string; is_decommissioned: boolean }>;
  allNodes: WorkflowNode[];
}

function NodeConfigEditor({ node, onChange, agents, allNodes }: NodeEditorProps) {
  const cfg = { ...(node.config || {}) };
  const setConfig = (key: string, value: unknown) => onChange({ ...node, config: { ...cfg, [key]: value } });
  const activeAgents = agents.filter(a => !a.is_decommissioned);
  const otherNodes = allNodes.filter(n => n.id !== node.id);

  switch (node.type) {
    case 'agent':
      return (
        <>
          <div className="hub-form-group">
            <label>Agent</label>
            <select
              value={node.agentId || ''}
              onChange={(e) => {
                const agent = activeAgents.find(a => a.id === e.target.value);
                onChange({ ...node, agentId: e.target.value, agentName: agent?.name || '' });
              }}
              className="fobs-select" style={{ width: '100%' }}
            >
              <option value="">Select an agent...</option>
              {activeAgents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>
          </div>
          <div className="hub-form-group">
            <label>Prompt Template</label>
            <textarea
              value={(cfg.prompt as string) || ''}
              onChange={(e) => setConfig('prompt', e.target.value)}
              placeholder="Describe the task for this agent..."
              rows={4}
            />
            <span className="fwb-context-hint">Reference previous outputs: {'{{nodeId.field}}'}</span>
          </div>
          <div className="hub-form-group">
            <label>Model Override <span className="optional">(optional)</span></label>
            <select
              value={(cfg.model as string) || ''}
              onChange={(e) => setConfig('model', e.target.value || undefined)}
              className="fobs-select" style={{ width: '100%' }}
            >
              <option value="">Use agent default</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
              <option value="claude-opus-4-6">Claude Opus 4.6</option>
            </select>
          </div>
          <div className="hub-form-group">
            <label>Max Cost <span className="optional">(optional, $)</span></label>
            <input
              type="number" min="0.01" step="0.10"
              value={(cfg.maxCost as number) || ''}
              onChange={(e) => setConfig('maxCost', e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="0.50"
              className="fobs-input" style={{ maxWidth: 120 }}
            />
          </div>
        </>
      );

    case 'condition':
      return (
        <>
          <div className="hub-form-group">
            <label>Expression</label>
            <input
              type="text"
              value={(cfg.expression as string) || ''}
              onChange={(e) => setConfig('expression', e.target.value)}
              placeholder='result.score > 80'
            />
            <span className="fwb-context-hint">
              Operators: ==, !=, {'>'}, {'<'}, {'>='}, {'<='}, contains, exists.
              Paths resolve from shared context.
            </span>
          </div>
          <p className="fwb-type-desc">Routes execution to different branches based on this expression. Add conditional edges from this node to target branches.</p>
        </>
      );

    case 'parallel':
      return (
        <>
          <div className="hub-form-group">
            <label>Nodes to Execute Concurrently</label>
            <div className="fwb-multi-select">
              {otherNodes.map(n => {
                const selected = ((cfg.nodeIds as string[]) || []).includes(n.id);
                return (
                  <label key={n.id} className={`fwb-multi-option ${selected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const current = (cfg.nodeIds as string[]) || [];
                        setConfig('nodeIds', e.target.checked ? [...current, n.id] : current.filter(id => id !== n.id));
                      }}
                    />
                    <span className="fwb-node-badge-sm" style={{ color: NODE_TYPES[n.type]?.color || '#6b7280' }}>
                      {NODE_TYPES[n.type]?.icon || '•'}
                    </span>
                    {n.label}
                  </label>
                );
              })}
            </div>
          </div>
        </>
      );

    case 'merge':
      return (
        <>
          <div className="hub-form-group">
            <label>Source Nodes to Merge</label>
            <div className="fwb-multi-select">
              {otherNodes.map(n => {
                const selected = ((cfg.sources as string[]) || []).includes(n.id);
                return (
                  <label key={n.id} className={`fwb-multi-option ${selected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const current = (cfg.sources as string[]) || [];
                        setConfig('sources', e.target.checked ? [...current, n.id] : current.filter(id => id !== n.id));
                      }}
                    />
                    <span className="fwb-node-badge-sm" style={{ color: NODE_TYPES[n.type]?.color || '#6b7280' }}>
                      {NODE_TYPES[n.type]?.icon || '•'}
                    </span>
                    {n.label}
                  </label>
                );
              })}
            </div>
          </div>
        </>
      );

    case 'transform':
      return (
        <>
          <div className="hub-form-group">
            <label>Key Mapping (JSON)</label>
            <textarea
              value={cfg.mapping ? JSON.stringify(cfg.mapping, null, 2) : ''}
              onChange={(e) => {
                try { setConfig('mapping', JSON.parse(e.target.value)); } catch { /* ignore invalid json while typing */ }
              }}
              placeholder={'{\n  "summary": "agent1.output",\n  "score": "agent2.result.score"\n}'}
              rows={5}
              className="fobs-input"
              style={{ fontFamily: 'monospace', fontSize: '0.75rem', width: '100%' }}
            />
            <span className="fwb-context-hint">Map output keys to context paths from previous nodes</span>
          </div>
        </>
      );

    case 'human_checkpoint':
      return (
        <>
          <div className="hub-form-group">
            <label>Checkpoint Type</label>
            <select
              value={(cfg.checkpointType as string) || 'approval'}
              onChange={(e) => setConfig('checkpointType', e.target.value)}
              className="fobs-select" style={{ width: '100%' }}
            >
              <option value="approval">Approval (yes/no)</option>
              <option value="review">Review (with feedback)</option>
              <option value="input">Input (free-form response)</option>
              <option value="confirmation">Confirmation (proceed/cancel)</option>
            </select>
          </div>
          <div className="hub-form-group">
            <label>Title</label>
            <input
              type="text"
              value={(cfg.title as string) || ''}
              onChange={(e) => setConfig('title', e.target.value)}
              placeholder="Review agent output before proceeding"
            />
          </div>
          <div className="hub-form-group">
            <label>Description <span className="optional">(optional)</span></label>
            <textarea
              value={(cfg.description as string) || ''}
              onChange={(e) => setConfig('description', e.target.value)}
              placeholder="Describe what the reviewer should check..."
              rows={3}
            />
          </div>
          <div className="hub-form-group">
            <label>Timeout (minutes) <span className="optional">(optional)</span></label>
            <input
              type="number" min="1" step="1"
              value={(cfg.timeoutMinutes as number) || ''}
              onChange={(e) => setConfig('timeoutMinutes', e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="5"
              className="fobs-input" style={{ maxWidth: 120 }}
            />
          </div>
        </>
      );

    case 'output':
      return (
        <div className="hub-form-group">
          <label>Source Key <span className="optional">(optional)</span></label>
          <input
            type="text"
            value={(cfg.source as string) || ''}
            onChange={(e) => setConfig('source', e.target.value)}
            placeholder="Leave empty to export full context"
          />
          <span className="fwb-context-hint">Specify a context key to export, e.g. "agent1" or "merged_result"</span>
        </div>
      );

    case 'input':
      return <p className="fwb-type-desc">This node passes the workflow&apos;s input data into the shared context as <code>__input</code>. No configuration needed.</p>;

    default:
      return <p className="fwb-type-desc">No configuration available for this node type.</p>;
  }
}

/* ─── Flow Node Card ─── */
function FlowNode({
  node, edges, onEdit, onDelete, onConnect,
}: {
  node: WorkflowNode;
  edges: WorkflowEdge[];
  onEdit: () => void;
  onDelete: () => void;
  onConnect: () => void;
}) {
  const meta = NODE_TYPES[node.type] || NODE_TYPES.agent;
  const warnings = getNodeWarnings(node, edges);
  const summary = nodeConfigSummary(node);
  const incomingEdges = edges.filter(e => e.to === node.id);

  return (
    <div className="fwb-flow-step">
      {incomingEdges.map((edge) => (
        <div key={`${edge.from}-${edge.to}`} className="fwb-flow-connector">
          {edge.condition && (
            <span className="fwb-edge-label">{edge.condition}</span>
          )}
        </div>
      ))}
      <div className="fwb-node" style={{ borderLeft: `3px solid ${meta.color}` }}>
        <div className="fwb-node-header">
          <div className="fwb-node-title-row">
            <span className="fwb-node-badge" style={{ color: meta.color, background: meta.bg }}>{meta.icon}</span>
            <span className="fwb-node-label">{node.label}</span>
            <span className="fwb-node-type-tag">{meta.label}</span>
          </div>
          <div className="fwb-node-actions">
            <button className="fwb-node-btn" onClick={onConnect} title="Connect to...">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v12M2 8h12"/></svg>
            </button>
            <button className="fwb-node-btn" onClick={onEdit} title="Edit">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>
            </button>
            <button className="fwb-node-btn fwb-node-btn--danger" onClick={onDelete} title="Remove">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
          </div>
        </div>
        <div className="fwb-node-config-summary">{summary}</div>
        {warnings.length > 0 && (
          <div className="fwb-node-warnings">
            {warnings.map((w, i) => (
              <span key={i} className="fwb-node-warning">⚠ {w}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── DAG Validation ─── */
function validateDAG(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const warnings: string[] = [];
  if (nodes.length === 0) return ['Workflow has no nodes'];

  const hasInput = nodes.some(n => n.type === 'input');
  const hasOutput = nodes.some(n => n.type === 'output');
  if (!hasInput) warnings.push('Missing an Input node (workflow entry point)');
  if (!hasOutput) warnings.push('Missing an Output node (collect final result)');

  // Orphaned nodes (no edges at all)
  const connected = new Set<string>();
  for (const e of edges) { connected.add(e.from); connected.add(e.to); }
  const orphans = nodes.filter(n => !connected.has(n.id) && nodes.length > 1);
  if (orphans.length > 0) warnings.push(`Orphaned nodes: ${orphans.map(n => n.label).join(', ')}`);

  // Agent nodes without agentId
  const unassigned = nodes.filter(n => n.type === 'agent' && !n.agentId && !n.config?.prompt);
  if (unassigned.length > 0) warnings.push(`Agent nodes missing config: ${unassigned.map(n => n.label).join(', ')}`);

  // Cycle detection (DFS)
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) adj.get(e.from)?.push(e.to);
  const visited = new Set<string>();
  const stack = new Set<string>();
  function hasCycle(id: string): boolean {
    visited.add(id);
    stack.add(id);
    for (const next of (adj.get(id) || [])) {
      if (stack.has(next)) return true;
      if (!visited.has(next) && hasCycle(next)) return true;
    }
    stack.delete(id);
    return false;
  }
  for (const n of nodes) {
    if (!visited.has(n.id) && hasCycle(n.id)) {
      warnings.push('Circular dependency detected — workflow will loop forever');
      break;
    }
  }

  return warnings;
}

/* ─── Main Component ─── */
export default function WorkflowBuilder() {
  const workflows = useHubStore((s) => s.workflows);
  const selectedWorkflow = useHubStore((s) => s.selectedWorkflow);
  const setSelectedWorkflow = useHubStore((s) => s.setSelectedWorkflow);
  const showCreateWorkflow = useHubStore((s) => s.showCreateWorkflow);
  const setShowCreateWorkflow = useHubStore((s) => s.setShowCreateWorkflow);
  const agents = useHubStore((s) => s.agents);
  const fetchWorkflows = useHubStore((s) => s.fetchWorkflows);
  const createWorkflow = useHubStore((s) => s.createWorkflow);
  const updateWorkflow = useHubStore((s) => s.updateWorkflow);
  const runWorkflow = useHubStore((s) => s.runWorkflow);
  const fetchWorkflowRuns = useHubStore((s) => s.fetchWorkflowRuns);
  const workflowRuns = useHubStore((s) => s.workflowRuns);
  const loading = useHubStore((s) => s.loading);

  const [showRuns, setShowRuns] = useState(false);
  const [newWorkflow, setNewWorkflow] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [editingNode, setEditingNode] = useState<WorkflowNode | null>(null);
  const [addingNodeType, setAddingNodeType] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateFilter, setTemplateFilter] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<WorkflowTemplate | null>(null);

  const poll = useCallback(() => { fetchWorkflows(); }, [fetchWorkflows]);
  usePolling(poll, 30000);

  useEffect(() => {
    if (selectedWorkflow) {
      fetchWorkflowRuns(selectedWorkflow.id);
    }
  }, [selectedWorkflow?.id, fetchWorkflowRuns]);

  const nodes: WorkflowNode[] = selectedWorkflow?.definition?.nodes || [];
  const edges: WorkflowEdge[] = selectedWorkflow?.definition?.edges || [];
  const dagWarnings = useMemo(() => validateDAG(nodes, edges), [nodes, edges]);
  const hasCriticalWarning = dagWarnings.some(w => w.includes('Circular') || w.includes('no nodes'));

  // Stats
  const stats = useMemo(() => {
    const active = workflows.filter(w => w.status === 'active').length;
    const draft = workflows.filter(w => w.status === 'draft').length;
    const totalNodes = workflows.reduce((s, w) => s + (w.definition?.nodes?.length || 0), 0);
    return { total: workflows.length, active, draft, totalNodes };
  }, [workflows]);

  /* ─── Handlers ─── */
  const handleCreate = async () => {
    if (!newWorkflow.name.trim()) return;
    setCreating(true);
    const name = newWorkflow.name;
    const description = newWorkflow.description || undefined;
    setShowCreateWorkflow(false);
    setNewWorkflow({ name: '', description: '' });
    await createWorkflow({ name, description });
    setCreating(false);
  };

  const handleCreateFromTemplate = async (tpl: WorkflowTemplate) => {
    setCreating(true);
    setShowTemplates(false);
    setPreviewTemplate(null);
    const ok = await createWorkflow({ name: tpl.name, description: tpl.description });
    if (ok) {
      // createWorkflow auto-selects the new workflow — grab it from the store and set the definition
      const newWf = useHubStore.getState().selectedWorkflow;
      if (newWf) {
        await updateWorkflow(newWf.id, {
          definition: { nodes: tpl.nodes, edges: tpl.edges },
        });
      }
    }
    setCreating(false);
  };

  const filteredTemplates = templateFilter
    ? WORKFLOW_TEMPLATES.filter(t => t.category === templateFilter)
    : WORKFLOW_TEMPLATES;

  const handleRun = async (wf: Workflow) => {
    setRunning(true);
    await runWorkflow(wf.id);
    setRunning(false);
  };

  const saveDefinition = async (newNodes: WorkflowNode[], newEdges: WorkflowEdge[]) => {
    if (!selectedWorkflow) return;
    await updateWorkflow(selectedWorkflow.id, { definition: { nodes: newNodes, edges: newEdges } });
  };

  const handleAddNode = (type: string) => {
    setAddingNodeType(type);
    setShowNodePicker(false);
    const id = `${type}-${Date.now().toString(36)}`;
    const meta = NODE_TYPES[type];
    const newNode: WorkflowNode = {
      id, type, label: `${meta?.label || type} ${nodes.length + 1}`,
      config: type === 'human_checkpoint' ? { checkpointType: 'approval' } : {},
    };
    setEditingNode(newNode);
  };

  const handleSaveNode = async () => {
    if (!editingNode) return;
    const existingIdx = nodes.findIndex(n => n.id === editingNode.id);
    let newNodes: WorkflowNode[];
    let newEdges = [...edges];

    if (existingIdx >= 0) {
      // Update existing
      newNodes = [...nodes];
      newNodes[existingIdx] = editingNode;
    } else {
      // Add new
      newNodes = [...nodes, editingNode];
      // Auto-connect from last node if there is one
      if (nodes.length > 0) {
        newEdges.push({ from: nodes[nodes.length - 1].id, to: editingNode.id });
      }
    }

    await saveDefinition(newNodes, newEdges);
    setEditingNode(null);
    setAddingNodeType(null);
  };

  const handleRemoveNode = async (nodeId: string) => {
    const idx = nodes.findIndex(n => n.id === nodeId);
    if (idx < 0) return;
    const newNodes = nodes.filter(n => n.id !== nodeId);
    // Remove edges to/from this node and reconnect
    let newEdges = edges.filter(e => e.from !== nodeId && e.to !== nodeId);
    // Reconnect: if node was between two others, connect them
    const incoming = edges.filter(e => e.to === nodeId).map(e => e.from);
    const outgoing = edges.filter(e => e.from === nodeId).map(e => e.to);
    for (const from of incoming) {
      for (const to of outgoing) {
        if (!newEdges.some(e => e.from === from && e.to === to)) {
          newEdges.push({ from, to });
        }
      }
    }
    await saveDefinition(newNodes, newEdges);
  };

  const handleConnect = async (fromId: string, toId: string, condition?: string) => {
    if (!selectedWorkflow) return;
    // Don't add duplicate edges
    if (edges.some(e => e.from === fromId && e.to === toId)) return;
    const newEdge: WorkflowEdge = { from: fromId, to: toId };
    if (condition) newEdge.condition = condition;
    await saveDefinition(nodes, [...edges, newEdge]);
    setConnectingFrom(null);
  };

  const handleRemoveEdge = async (from: string, to: string) => {
    await saveDefinition(nodes, edges.filter(e => !(e.from === from && e.to === to)));
  };

  return (
    <div className="fwb-container">
      {/* ─── List View ─── */}
      {!selectedWorkflow && (
        <>
          {/* Stats */}
          <div className="fwb-stats-row">
            <div className="fwb-stat-card">
              <div className="fwb-stat-value">{stats.total}</div>
              <div className="fwb-stat-label">Workflows</div>
            </div>
            <div className="fwb-stat-card fwb-stat-card--success">
              <div className="fwb-stat-value">{stats.active}</div>
              <div className="fwb-stat-label">Active</div>
            </div>
            <div className="fwb-stat-card fwb-stat-card--warn">
              <div className="fwb-stat-value">{stats.draft}</div>
              <div className="fwb-stat-label">Draft</div>
            </div>
            <div className="fwb-stat-card fwb-stat-card--info">
              <div className="fwb-stat-value">{stats.totalNodes}</div>
              <div className="fwb-stat-label">Total Nodes</div>
            </div>
          </div>

          <div className="fwb-list-header">
            <span className="fwb-list-count">{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</span>
            <div className="fwb-list-actions">
              <button className="fo-action-btn fwb-template-btn" onClick={() => setShowTemplates(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                From Template
              </button>
              <button className="fo-action-btn" onClick={() => setShowCreateWorkflow(true)}>+ New Workflow</button>
            </div>
          </div>

          {loading['workflows'] && workflows.length === 0 ? (
            <div className="fwb-empty-state">
              <div className="fwb-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                  <path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="10"/>
                </svg>
              </div>
              <div className="fwb-empty-text">Loading workflows...</div>
            </div>
          ) : workflows.length === 0 ? (
            <div className="fwb-empty-state">
              <div className="fwb-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>
                </svg>
              </div>
              <div className="fwb-empty-text">No workflows yet</div>
              <div className="fwb-empty-sub">Create a workflow to build multi-agent DAG pipelines with branching, parallel execution, and human checkpoints.</div>
              <div className="fwb-empty-actions">
                <button className="fo-action-btn fwb-template-btn" onClick={() => setShowTemplates(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                  Start from Template
                </button>
                <button className="fo-action-btn" onClick={() => setShowCreateWorkflow(true)}>+ Blank Workflow</button>
              </div>
            </div>
          ) : (
            <div className="fwb-workflow-list">
              {workflows.map((wf) => (
                <div key={wf.id} className="fwb-workflow-card fo-panel" onClick={() => setSelectedWorkflow(wf)}>
                  <div className="fwb-workflow-header">
                    <div>
                      <strong className="fwb-workflow-name">{wf.name}</strong>
                      <StatusBadge status={wf.status} />
                    </div>
                    <span className="fwb-workflow-meta">
                      v{wf.version} · {(wf.definition?.nodes || []).length} nodes · Updated {relativeTime(wf.updated_at)}
                    </span>
                  </div>
                  {wf.description && <p className="fwb-workflow-desc">{wf.description}</p>}
                  {(wf.definition?.nodes || []).length > 0 && (
                    <div className="fwb-mini-flow">
                      {(wf.definition.nodes).map((node, i) => {
                        const meta = NODE_TYPES[node.type] || NODE_TYPES.agent;
                        return (
                          <span key={node.id} className="fwb-mini-node" style={{ borderColor: meta.color }}>
                            {i > 0 && <span className="fwb-mini-arrow">→</span>}
                            <span style={{ color: meta.color }}>{meta.icon}</span>
                            {node.label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── Detail / Builder View ─── */}
      {selectedWorkflow && (
        <>
          <div className="fwb-detail-header">
            <button className="fwb-back-btn" onClick={() => setSelectedWorkflow(null)}>← Back</button>
            <div className="fwb-detail-title">
              <h3>{selectedWorkflow.name}</h3>
              <StatusBadge status={selectedWorkflow.status} />
              <span className="fwb-workflow-meta">v{selectedWorkflow.version} · {nodes.length} nodes · {edges.length} edges</span>
            </div>
            <div className="fwb-detail-actions">
              <button
                className="fo-action-btn fo-action-btn--primary"
                onClick={() => handleRun(selectedWorkflow)}
                disabled={running || nodes.length === 0 || hasCriticalWarning}
                title={hasCriticalWarning ? dagWarnings.join('; ') : ''}
              >
                {running ? 'Starting...' : '▶ Run'}
              </button>
              {selectedWorkflow.status === 'draft' && (
                <button className="fo-action-btn" onClick={() => updateWorkflow(selectedWorkflow.id, { status: 'active' })} disabled={hasCriticalWarning}>
                  Activate
                </button>
              )}
              {selectedWorkflow.status === 'active' && (
                <button className="fo-action-btn" onClick={() => updateWorkflow(selectedWorkflow.id, { status: 'paused' })}>
                  Pause
                </button>
              )}
              {selectedWorkflow.status === 'paused' && (
                <button className="fo-action-btn" onClick={() => updateWorkflow(selectedWorkflow.id, { status: 'active' })} disabled={hasCriticalWarning}>
                  Resume
                </button>
              )}
              <button
                className="fo-action-btn fwb-archive-btn"
                onClick={() => { updateWorkflow(selectedWorkflow.id, { status: 'archived' }); setSelectedWorkflow(null); }}
              >
                Archive
              </button>
            </div>
          </div>

          {selectedWorkflow.description && (
            <p className="fwb-detail-desc">{selectedWorkflow.description}</p>
          )}

          {dagWarnings.length > 0 && (
            <div className="fwb-dag-warnings">
              {dagWarnings.map((w, i) => (
                <div key={i} className="fwb-dag-warning">{w}</div>
              ))}
            </div>
          )}

          {/* Canvas */}
          <div className="fo-panel">
            <div className="fo-panel-header">
              <span className="fo-panel-title">Pipeline</span>
              <span className="fo-panel-count">{nodes.length} nodes · {edges.length} edges</span>
            </div>

            <div className="fwb-flow">
              {nodes.length === 0 && (
                <div className="fwb-canvas-empty">
                  <p>No nodes yet. Add your first node to start building the workflow.</p>
                </div>
              )}

              {nodes.map((node) => (
                <FlowNode
                  key={node.id}
                  node={node}
                  edges={edges}
                  onEdit={() => setEditingNode({ ...node })}
                  onDelete={() => handleRemoveNode(node.id)}
                  onConnect={() => setConnectingFrom(node.id)}
                />
              ))}

              {/* Node Type Picker */}
              {showNodePicker ? (
                <div className="fwb-node-type-picker">
                  <div className="fwb-picker-header">
                    <span>Add Node</span>
                    <button className="fwb-node-btn" onClick={() => setShowNodePicker(false)} title="Cancel">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                    </button>
                  </div>
                  <div className="fwb-type-grid">
                    {NODE_TYPE_KEYS.map(type => {
                      const meta = NODE_TYPES[type];
                      return (
                        <button key={type} className="fwb-node-type-btn" onClick={() => handleAddNode(type)}>
                          <span className="fwb-type-btn-icon" style={{ color: meta.color, background: meta.bg }}>{meta.icon}</span>
                          <span className="fwb-type-btn-label">{meta.label}</span>
                          <span className="fwb-type-btn-desc">{meta.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <button className="fwb-add-node" onClick={() => setShowNodePicker(true)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                  Add Node
                </button>
              )}
            </div>
          </div>

          {/* Edge List */}
          {edges.length > 0 && (
            <div className="fo-panel fwb-edge-panel">
              <div className="fo-panel-header">
                <span className="fo-panel-title">Connections</span>
                <span className="fo-panel-count">{edges.length}</span>
              </div>
              <div className="fwb-edge-list">
                {edges.map((edge, i) => {
                  const fromNode = nodes.find(n => n.id === edge.from);
                  const toNode = nodes.find(n => n.id === edge.to);
                  return (
                    <div key={i} className="fwb-edge-item">
                      <span className="fwb-edge-from">{fromNode?.label || edge.from}</span>
                      <span className="fwb-edge-arrow">→</span>
                      <span className="fwb-edge-to">{toNode?.label || edge.to}</span>
                      {edge.condition && <span className="fwb-edge-cond">when: {edge.condition}</span>}
                      <button className="fwb-node-btn fwb-node-btn--danger fwb-edge-remove" onClick={() => handleRemoveEdge(edge.from, edge.to)} title="Remove edge">
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Run History */}
          <div className="fo-panel">
            <div className="fo-panel-header" style={{ cursor: 'pointer' }} onClick={() => setShowRuns(!showRuns)}>
              <span className="fo-panel-title">Run History {showRuns ? '\u25BE' : '\u25B8'}</span>
              <span className="fo-panel-count">{workflowRuns.length}</span>
            </div>
            {showRuns && (
              <div className="fwb-run-list" style={{ padding: '0.5rem' }}>
                {workflowRuns.length === 0 ? (
                  <div className="fwb-canvas-empty" style={{ padding: '1rem' }}>
                    <p>No runs yet. Click "Run" to execute this workflow.</p>
                  </div>
                ) : workflowRuns.map(run => (
                  <div key={run.id} className="fwb-edge-item" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <StatusBadge status={run.status} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>
                      {new Date(run.created_at).toLocaleString()}
                    </span>
                    {run.current_node && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary, #6b7280)' }}>
                        @ {run.current_node}
                      </span>
                    )}
                    {run.error && (
                      <span style={{ fontSize: '0.75rem', color: '#ef4444', marginLeft: 'auto', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {run.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── Connect Modal ─── */}
      {connectingFrom && (
        <Modal title="Connect To..." onClose={() => setConnectingFrom(null)} size="small">
          <p className="fwb-type-desc">Select a target node to connect from <strong>{nodes.find(n => n.id === connectingFrom)?.label}</strong>:</p>
          <div className="fwb-connect-list">
            {nodes.filter(n => n.id !== connectingFrom && !edges.some(e => e.from === connectingFrom && e.to === n.id)).map(n => {
              const meta = NODE_TYPES[n.type] || NODE_TYPES.agent;
              return (
                <button key={n.id} className="fwb-connect-option" onClick={() => handleConnect(connectingFrom, n.id)}>
                  <span className="fwb-node-badge-sm" style={{ color: meta.color }}>{meta.icon}</span>
                  {n.label}
                  <span className="fwb-connect-type">{meta.label}</span>
                </button>
              );
            })}
            {nodes.filter(n => n.id !== connectingFrom && !edges.some(e => e.from === connectingFrom && e.to === n.id)).length === 0 && (
              <p className="fwb-type-desc">No available nodes to connect to (all already connected).</p>
            )}
          </div>
          {/* Conditional edge (if source is condition type) */}
          {nodes.find(n => n.id === connectingFrom)?.type === 'condition' && (
            <div className="hub-form-group" style={{ marginTop: '0.75rem' }}>
              <label>Edge Condition <span className="optional">(optional)</span></label>
              <input type="text" id="edge-condition-input" placeholder='e.g. result == "approved"' />
              <span className="fwb-context-hint">Leave empty for unconditional edge</span>
            </div>
          )}
        </Modal>
      )}

      {/* ─── Edit / Add Node Modal ─── */}
      {editingNode && (
        <Modal title={addingNodeType ? `Add ${NODE_TYPES[addingNodeType]?.label || 'Node'}` : `Edit ${editingNode.label}`} onClose={() => { setEditingNode(null); setAddingNodeType(null); }}>
          <div className="hub-form-group">
            <label>Label</label>
            <input
              type="text"
              value={editingNode.label}
              onChange={(e) => setEditingNode({ ...editingNode, label: e.target.value })}
            />
          </div>
          <NodeConfigEditor
            node={editingNode}
            onChange={setEditingNode}
            agents={agents}
            allNodes={nodes}
          />
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => { setEditingNode(null); setAddingNodeType(null); }}>Cancel</button>
            <button className="hub-btn hub-btn--primary" onClick={handleSaveNode}>
              {addingNodeType ? 'Add Node' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {/* ─── Create Workflow Modal ─── */}
      {showCreateWorkflow && (
        <Modal title="New Workflow" onClose={() => setShowCreateWorkflow(false)}>
          <div className="hub-form-group">
            <label>Name</label>
            <input type="text" value={newWorkflow.name} onChange={(e) => setNewWorkflow({ ...newWorkflow, name: e.target.value })} placeholder="e.g., Deploy Pipeline" />
          </div>
          <div className="hub-form-group">
            <label>Description <span className="optional">(optional)</span></label>
            <textarea value={newWorkflow.description} onChange={(e) => setNewWorkflow({ ...newWorkflow, description: e.target.value })} placeholder="What does this workflow do?" rows={3} />
          </div>
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => setShowCreateWorkflow(false)}>Cancel</button>
            <button className="hub-btn hub-btn--primary" onClick={handleCreate} disabled={creating || !newWorkflow.name.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </Modal>
      )}

      {/* ─── Template Picker Modal ─── */}
      {showTemplates && !previewTemplate && (
        <Modal title="Start from Template" onClose={() => { setShowTemplates(false); setTemplateFilter(null); }} size="large">
          <p className="fwb-type-desc">Choose a pre-built workflow template. You can customize it after creation.</p>

          <div className="fwb-tpl-categories">
            <button
              className={`fwb-tpl-cat-btn ${templateFilter === null ? 'active' : ''}`}
              onClick={() => setTemplateFilter(null)}
            >
              All
            </button>
            {TEMPLATE_CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`fwb-tpl-cat-btn ${templateFilter === cat ? 'active' : ''}`}
                onClick={() => setTemplateFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="fwb-tpl-grid">
            {filteredTemplates.map(tpl => (
              <div key={tpl.id} className="fwb-tpl-card" onClick={() => setPreviewTemplate(tpl)}>
                <div className="fwb-tpl-card-header">
                  <span className="fwb-tpl-icon" style={{ background: tpl.color + '20', color: tpl.color }}>
                    {tpl.icon}
                  </span>
                  <div>
                    <div className="fwb-tpl-name">{tpl.name}</div>
                    <span className="fwb-tpl-cat">{tpl.category}</span>
                  </div>
                </div>
                <p className="fwb-tpl-desc">{tpl.description}</p>
                <div className="fwb-tpl-meta">
                  <span>{tpl.nodes.length} nodes</span>
                  <span>{tpl.edges.length} edges</span>
                  <span>{tpl.nodes.filter(n => n.type === 'agent').length} agents</span>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* ─── Template Preview Modal ─── */}
      {previewTemplate && (
        <Modal title={previewTemplate.name} onClose={() => setPreviewTemplate(null)} size="large">
          <div className="fwb-tpl-preview">
            <div className="fwb-tpl-preview-header">
              <span className="fwb-tpl-icon-lg" style={{ background: previewTemplate.color + '20', color: previewTemplate.color }}>
                {previewTemplate.icon}
              </span>
              <div>
                <p className="fwb-tpl-desc" style={{ margin: 0 }}>{previewTemplate.description}</p>
                <div className="fwb-tpl-meta" style={{ marginTop: '0.5rem' }}>
                  <span className="fwb-tpl-cat">{previewTemplate.category}</span>
                  <span>{previewTemplate.nodes.length} nodes</span>
                  <span>{previewTemplate.edges.length} edges</span>
                </div>
              </div>
            </div>

            <div className="fwb-tpl-preview-label">Pipeline Preview</div>
            <div className="fwb-tpl-preview-flow">
              {previewTemplate.nodes.map((node, i) => {
                const meta = NODE_TYPES[node.type] || NODE_TYPES.agent;
                const inEdges = previewTemplate.edges.filter(e => e.to === node.id);
                return (
                  <div key={node.id} className="fwb-tpl-preview-step">
                    {i > 0 && inEdges.length > 0 && (
                      <div className="fwb-flow-connector" style={{ height: 20 }}>
                        {inEdges[0]?.condition && (
                          <span className="fwb-edge-label">{inEdges[0].condition}</span>
                        )}
                      </div>
                    )}
                    <div className="fwb-tpl-preview-node" style={{ borderLeft: `3px solid ${meta.color}` }}>
                      <span className="fwb-node-badge" style={{ color: meta.color, background: meta.bg }}>{meta.icon}</span>
                      <span className="fwb-tpl-preview-node-label">{node.label}</span>
                      <span className="fwb-node-type-tag">{meta.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hub-modal-actions">
              <button className="hub-btn" onClick={() => setPreviewTemplate(null)}>← Back to Templates</button>
              <button
                className="hub-btn hub-btn--primary"
                onClick={() => handleCreateFromTemplate(previewTemplate)}
                disabled={creating}
              >
                {creating ? 'Creating...' : `Use "${previewTemplate.name}"`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
