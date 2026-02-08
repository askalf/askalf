import SettingsPanel from '../components/settings/SettingsPage';

export default function SettingsPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure your SELF's behavior, limits, and preferences.</p>
      </div>
      <SettingsPanel />
    </div>
  );
}
