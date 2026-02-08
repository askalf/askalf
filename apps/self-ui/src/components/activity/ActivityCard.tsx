import { useState } from 'react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import type { Activity } from '../../api/activity';

const typeIcons: Record<string, string> = {
  action: '\u2699\uFE0F',
  chat: '\uD83D\uDCAC',
  approval: '\u2705',
  integration: '\uD83D\uDD17',
  system: '\u2139\uFE0F',
};

interface Props {
  activity: Activity;
}

export default function ActivityCard({ activity }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={clsx('activity-card', expanded && 'expanded')}
      onClick={() => setExpanded(!expanded)}
      style={{ cursor: 'pointer' }}
    >
      <div className={clsx('activity-icon', activity.type)}>
        {typeIcons[activity.type] || '\u2139\uFE0F'}
      </div>
      <div className="activity-body">
        <div className="activity-title">{activity.title}</div>
        {activity.description && (
          <div className="activity-desc" style={expanded ? undefined : {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {activity.description}
          </div>
        )}
        <div className="activity-footer">
          <span>{formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}</span>
          {activity.cost != null && activity.cost > 0 && (
            <span className="activity-cost">${activity.cost.toFixed(4)}</span>
          )}
          <span className={`badge badge-${activity.importance === 'high' ? 'danger' : activity.importance === 'medium' ? 'warning' : 'info'}`}>
            {activity.importance}
          </span>
        </div>
        {expanded && activity.metadata && Object.keys(activity.metadata).length > 0 && (
          <div style={{
            marginTop: 'var(--space-sm)',
            padding: 'var(--space-sm)',
            background: 'var(--surface)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8125rem',
            color: 'var(--text-tertiary)',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {JSON.stringify(activity.metadata, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}
