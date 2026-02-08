import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settings';
import { useSelfStore } from '../../stores/self';
import { pauseSelf, resumeSelf } from '../../api/self';
import AutonomySlider from '../common/AutonomySlider';

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button className={`toggle${on ? ' on' : ''}`} onClick={onToggle} type="button">
      <span className="toggle-knob" />
    </button>
  );
}

export default function SettingsPanel() {
  const { settings, isLoading, isSaving, fetchSettings, updateSettings } = useSettingsStore();
  const { self, setSelf } = useSelfStore();
  const [name, setName] = useState('');
  const [autonomy, setAutonomy] = useState(3);
  const [dailyBudget, setDailyBudget] = useState('1.00');
  const [monthlyBudget, setMonthlyBudget] = useState('20.00');

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settings) {
      setName(settings.name);
      setAutonomy(settings.autonomyLevel);
      setDailyBudget(settings.dailyBudget.toFixed(2));
      setMonthlyBudget(settings.monthlyBudget.toFixed(2));
    }
  }, [settings]);

  const handleSave = async () => {
    await updateSettings({
      name,
      autonomyLevel: autonomy,
      dailyBudget: parseFloat(dailyBudget) || 0,
      monthlyBudget: parseFloat(monthlyBudget) || 0,
    });
  };

  const handleTogglePause = async () => {
    if (!self) return;
    try {
      if (self.status === 'active') {
        const result = await pauseSelf();
        setSelf(result.self);
      } else {
        const result = await resumeSelf();
        setSelf(result.self);
      }
    } catch (err) {
      console.error('Failed to toggle pause:', err);
    }
  };

  if (isLoading || !settings) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading settings...
      </div>
    );
  }

  return (
    <div>
      <div className="settings-section">
        <h3 className="settings-section-title">General</h3>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">SELF Name</div>
            <div className="settings-row-desc">What your AI agent calls itself</div>
          </div>
          <div className="settings-row-control">
            <input
              className="input input-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '200px' }}
              maxLength={32}
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Status</div>
            <div className="settings-row-desc">
              {self?.status === 'active' ? 'SELF is actively working' : 'SELF is paused'}
            </div>
          </div>
          <div className="settings-row-control">
            <Toggle on={self?.status === 'active'} onToggle={handleTogglePause} />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Autonomy</h3>
        <div style={{ maxWidth: '500px' }}>
          <AutonomySlider value={autonomy} onChange={setAutonomy} />
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Budget Limits</h3>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Daily Budget</div>
            <div className="settings-row-desc">Maximum spend per day (USD)</div>
          </div>
          <div className="settings-row-control">
            <input
              className="input input-sm"
              type="number"
              step="0.01"
              min="0"
              value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)}
              style={{ width: '120px' }}
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Monthly Budget</div>
            <div className="settings-row-desc">Maximum spend per month (USD)</div>
          </div>
          <div className="settings-row-control">
            <input
              className="input input-sm"
              type="number"
              step="0.01"
              min="0"
              value={monthlyBudget}
              onChange={(e) => setMonthlyBudget(e.target.value)}
              style={{ width: '120px' }}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Notifications</h3>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Push Notifications</div>
            <div className="settings-row-desc">Get notified when SELF needs your attention</div>
          </div>
          <div className="settings-row-control">
            <Toggle
              on={settings.notificationsEnabled}
              onToggle={() => updateSettings({ notificationsEnabled: !settings.notificationsEnabled })}
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Email Digest</div>
            <div className="settings-row-desc">Daily summary of SELF activity via email</div>
          </div>
          <div className="settings-row-control">
            <Toggle
              on={settings.emailDigest}
              onToggle={() => updateSettings({ emailDigest: !settings.emailDigest })}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Working Hours</h3>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Restrict to Working Hours</div>
            <div className="settings-row-desc">SELF only acts during specified hours</div>
          </div>
          <div className="settings-row-control">
            <Toggle
              on={settings.workingHoursOnly}
              onToggle={() => updateSettings({ workingHoursOnly: !settings.workingHoursOnly })}
            />
          </div>
        </div>

        {settings.workingHoursOnly && (
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Hours</div>
              <div className="settings-row-desc">When SELF is allowed to act autonomously</div>
            </div>
            <div className="settings-row-control" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <input
                className="input input-sm"
                type="time"
                value={settings.workingHoursStart}
                onChange={(e) => updateSettings({ workingHoursStart: e.target.value })}
                style={{ width: '120px' }}
              />
              <span style={{ color: 'var(--text-muted)' }}>to</span>
              <input
                className="input input-sm"
                type="time"
                value={settings.workingHoursEnd}
                onChange={(e) => updateSettings({ workingHoursEnd: e.target.value })}
                style={{ width: '120px' }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)', paddingTop: 'var(--space-lg)' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
