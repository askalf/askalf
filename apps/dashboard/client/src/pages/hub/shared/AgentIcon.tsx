export const AGENT_TYPE_INFO: Record<string, { icon: string; color: string; label: string }> = {
  dev: { icon: '🔧', color: '#8b5cf6', label: 'Development' },
  research: { icon: '🔬', color: '#3b82f6', label: 'Research' },
  support: { icon: '💬', color: '#10b981', label: 'Support' },
  content: { icon: '✍️', color: '#f59e0b', label: 'Content' },
  monitor: { icon: '📊', color: '#ef4444', label: 'Monitoring' },
  custom: { icon: '⚡', color: '#6366f1', label: 'Custom' },
};

export const STATUS_INFO: Record<string, { color: string; label: string }> = {
  idle: { color: '#6b7280', label: 'Idle' },
  running: { color: '#10b981', label: 'Running' },
  paused: { color: '#f59e0b', label: 'Paused' },
  error: { color: '#ef4444', label: 'Error' },
};

interface AgentIconProps {
  type: string;
  size?: 'small' | 'medium' | 'large';
  decommissioned?: boolean;
}

export default function AgentIcon({ type, size = 'medium', decommissioned }: AgentIconProps) {
  const info = AGENT_TYPE_INFO[type] || AGENT_TYPE_INFO.custom;
  const sizeMap = { small: '28px', medium: '36px', large: '44px' };
  const fontMap = { small: '14px', medium: '18px', large: '22px' };
  return (
    <span
      className="hub-agent-icon"
      style={{
        background: decommissioned ? '#4b5563' : info.color,
        width: sizeMap[size],
        height: sizeMap[size],
        fontSize: fontMap[size],
      }}
    >
      {info.icon}
    </span>
  );
}
