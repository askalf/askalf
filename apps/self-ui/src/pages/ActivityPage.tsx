import ActivityFeed from '../components/activity/ActivityFeed';

export default function ActivityPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Activity</h1>
        <p className="page-subtitle">Everything your SELF has been doing, in real-time.</p>
      </div>
      <ActivityFeed showFilters />
    </div>
  );
}
