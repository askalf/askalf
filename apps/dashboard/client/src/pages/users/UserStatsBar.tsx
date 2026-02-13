import { useUsersStore } from '../../stores/users';
import StatCard from '../hub/shared/StatCard';
import LoadingSkeleton from '../hub/shared/LoadingSkeleton';

export default function UserStatsBar() {
  const stats = useUsersStore((s) => s.stats);
  const loading = useUsersStore((s) => s.loading.users);

  if (loading && !stats) return <LoadingSkeleton type="stats" />;
  if (!stats) return null;

  return (
    <div className="users-stats-grid">
      <StatCard icon="👤" value={stats.users.total} label="Total Users" />
      <StatCard icon="✓" value={stats.users.active} label="Active" variant="success" />
      <StatCard icon="+" value={stats.users.today} label="New Today" />
      <StatCard icon="📦" value={stats.content.shards} label="Total Shards" />
      <StatCard icon="⚡" value={stats.content.executionsToday} label="Exec Today" />
    </div>
  );
}
