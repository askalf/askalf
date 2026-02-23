import { useState, useEffect } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { SchedulerStatus } from '../../hooks/useHubApi';

interface TopBarProps {
  wsConnected: boolean;
  agentCount: number;
  ticketCount: number;
  todayCost: number;
}

export default function TopBar({ wsConnected, agentCount, ticketCount, todayCost }: TopBarProps) {
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    hubApi.reports.scheduler().then(setSchedulerStatus).catch(() => {});
    const timer = setInterval(() => {
      hubApi.reports.scheduler().then(setSchedulerStatus).catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const toggleScheduler = async () => {
    if (toggling || !schedulerStatus) return;
    setToggling(true);
    try {
      const action = schedulerStatus.running ? 'stop' : 'start';
      await hubApi.reports.toggleScheduler(action);
      const updated = await hubApi.reports.scheduler();
      setSchedulerStatus(updated);
    } catch {
      // ignore
    }
    setToggling(false);
  };

  const healthColor = wsConnected ? '#22c55e' : '#ef4444';
  const healthLabel = wsConnected ? 'Healthy' : 'Disconnected';

  return (
    <div className="ud-topbar">
      <div className="ud-topbar-left">
        <span className="ud-health-dot" style={{ background: healthColor }} />
        <span className="ud-topbar-label">{healthLabel}</span>
        <span className="ud-topbar-divider" />
        <span className="ud-topbar-stat">{agentCount} running</span>
        <span className="ud-topbar-divider" />
        <span className="ud-topbar-stat">{ticketCount} tickets</span>
        <span className="ud-topbar-divider" />
        <span className="ud-topbar-stat">${todayCost.toFixed(2)} today</span>
      </div>
      <div className="ud-topbar-right">
        <button
          className={`ud-scheduler-toggle ${schedulerStatus?.running ? 'running' : 'stopped'}`}
          onClick={toggleScheduler}
          disabled={toggling}
          title={schedulerStatus?.running ? 'Stop Scheduler' : 'Start Scheduler'}
        >
          {schedulerStatus?.running ? '⏸' : '▶'}
        </button>
      </div>
    </div>
  );
}
