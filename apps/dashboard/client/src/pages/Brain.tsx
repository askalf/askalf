import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBrainStore, type BrainTab } from '../stores/brain';
import BrainDashboard from './brain/BrainDashboard';
import BrainBrowse from './brain/BrainBrowse';
import BrainPacks from './brain/BrainPacks';
import BrainDetailModal from './brain/BrainDetailModal';
import './Brain.css';

const VALID_TABS: BrainTab[] = ['dashboard', 'browse', 'packs'];

export default function Brain() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeTab, setActiveTab } = useBrainStore();

  // Sync URL → store on mount and URL changes
  useEffect(() => {
    const urlTab = searchParams.get('tab') as BrainTab | null;
    if (urlTab && VALID_TABS.includes(urlTab)) {
      setActiveTab(urlTab);
    }
  }, [searchParams, setActiveTab]);

  useEffect(() => {
    document.title = 'My Brain — Ask ALF';
  }, []);

  const handleTabChange = (tab: BrainTab) => {
    setActiveTab(tab);
    if (tab === 'dashboard') {
      setSearchParams({});
    } else {
      setSearchParams({ tab });
    }
  };

  return (
    <div className="brain-page">
      {/* Header */}
      <div className="brain-header">
        <h1>My Brain</h1>
        <p>Your personal knowledge hub — see how much ALF saves you</p>
      </div>

      {/* Tab Bar */}
      <div className="brain-tabs">
        <button
          className={`brain-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => handleTabChange('dashboard')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M18 20V10" />
            <path d="M12 20V4" />
            <path d="M6 20v-6" />
          </svg>
          Dashboard
        </button>
        <button
          className={`brain-tab ${activeTab === 'browse' ? 'active' : ''}`}
          onClick={() => handleTabChange('browse')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          Browse
        </button>
        <button
          className={`brain-tab ${activeTab === 'packs' ? 'active' : ''}`}
          onClick={() => handleTabChange('packs')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          Packs
        </button>
      </div>

      {/* Tab Content */}
      <div className="brain-tab-content">
        {activeTab === 'dashboard' && <BrainDashboard />}
        {activeTab === 'browse' && <BrainBrowse />}
        {activeTab === 'packs' && <BrainPacks />}
      </div>

      {/* Modals */}
      <BrainDetailModal />
    </div>
  );
}
