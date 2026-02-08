import clsx from 'clsx';
import type { Integration } from '../../api/integrations';

interface Props {
  integration: Integration;
  onConnect: (type: string) => void;
  onDisconnect: (id: string) => void;
}

export default function IntegrationCard({ integration, onConnect, onDisconnect }: Props) {
  const isConnected = integration.status === 'connected';
  const isError = integration.status === 'error';

  return (
    <div className={clsx('integration-card', isConnected && 'connected')}>
      <div className="integration-header">
        <div className="integration-icon">{integration.icon}</div>
        <div>
          <div className="integration-name">{integration.name}</div>
          {isConnected && <span className="badge badge-success">Connected</span>}
          {isError && <span className="badge badge-danger">Error</span>}
        </div>
      </div>
      <p className="integration-desc">{integration.description}</p>
      <div className="integration-footer">
        {isConnected ? (
          <button className="btn btn-danger btn-sm" onClick={() => onDisconnect(integration.id)}>
            Disconnect
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => onConnect(integration.type)}>
            Connect
          </button>
        )}
      </div>
    </div>
  );
}
