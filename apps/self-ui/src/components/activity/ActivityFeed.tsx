import { useEffect } from 'react';
import { useActivityStore } from '../../stores/activity';
import { useSSE } from '../../hooks/useSSE';
import type { Activity } from '../../api/activity';
import ActivityCard from './ActivityCard';
import ActivityFilters from './ActivityFilters';
import EmptyState from '../common/EmptyState';

interface Props {
  showFilters?: boolean;
  limit?: number;
}

export default function ActivityFeed({ showFilters = true, limit }: Props) {
  const { activities, total, isLoading, isLoadingMore, filter, fetchActivities, setFilter, loadMore, addActivity } = useActivityStore();

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // SSE for real-time updates
  useSSE({
    url: '/api/v1/self/activity/stream',
    onMessage: (data) => {
      const activity = data as Activity;
      if (activity?.id) {
        addActivity(activity);
      }
    },
  });

  const displayed = limit ? activities.slice(0, limit) : activities;
  const hasMore = !limit && activities.length < total;

  return (
    <div>
      {showFilters && <ActivityFilters active={filter} onChange={setFilter} />}

      {isLoading && activities.length === 0 ? (
        <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading activity...
        </div>
      ) : displayed.length === 0 ? (
        <EmptyState
          icon="&#128203;"
          title="No activity yet"
          text="When your SELF takes actions, they'll appear here in real-time."
        />
      ) : (
        <div className="activity-feed">
          {displayed.map((a) => (
            <ActivityCard key={a.id} activity={a} />
          ))}
          {hasMore && (
            <div style={{ textAlign: 'center', padding: 'var(--space-lg)' }}>
              <button className="btn btn-secondary" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading...' : `Load More (${activities.length} of ${total})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
