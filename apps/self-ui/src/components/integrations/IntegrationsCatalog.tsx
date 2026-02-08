import { useState, useEffect } from 'react';
import * as integrationsApi from '../../api/integrations';
import type { Integration } from '../../api/integrations';
import IntegrationCard from './IntegrationCard';
import EmptyState from '../common/EmptyState';

export default function IntegrationsCatalog() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    integrationsApi.getIntegrations()
      .then((data) => {
        setIntegrations(data.integrations);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, []);

  const handleConnect = async (type: string) => {
    try {
      const result = await integrationsApi.connectIntegration(type);
      if (result.authUrl) {
        // OAuth flow — open popup
        window.open(result.authUrl, '_blank', 'width=600,height=700');
      } else if (result.integration) {
        setIntegrations((prev) =>
          prev.map((i) => (i.type === type ? { ...i, status: 'connected' as const } : i))
        );
      }
    } catch (err) {
      console.error('Failed to connect integration:', err);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await integrationsApi.disconnectIntegration(id);
      setIntegrations((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: 'available' as const } : i))
      );
    } catch (err) {
      console.error('Failed to disconnect integration:', err);
    }
  };

  const connected = integrations.filter((i) => i.status === 'connected');
  const available = integrations.filter((i) => i.status !== 'connected');

  if (isLoading) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading integrations...
      </div>
    );
  }

  if (integrations.length === 0) {
    return (
      <EmptyState
        icon="&#128268;"
        title="No integrations available"
        text="Integrations will appear here as they become available."
      />
    );
  }

  return (
    <div>
      {connected.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-md)' }}>
            Connected ({connected.length})
          </h3>
          <div className="integrations-grid" style={{ marginBottom: 'var(--space-xl)' }}>
            {connected.map((i) => (
              <IntegrationCard key={i.id} integration={i} onConnect={handleConnect} onDisconnect={handleDisconnect} />
            ))}
          </div>
        </>
      )}

      {available.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-md)' }}>
            Available ({available.length})
          </h3>
          <div className="integrations-grid">
            {available.map((i) => (
              <IntegrationCard key={i.id} integration={i} onConnect={handleConnect} onDisconnect={handleDisconnect} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
