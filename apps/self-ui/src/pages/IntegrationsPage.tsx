import IntegrationsCatalog from '../components/integrations/IntegrationsCatalog';

export default function IntegrationsPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Integrations</h1>
        <p className="page-subtitle">Connect services so your SELF can work with your tools.</p>
      </div>
      <IntegrationsCatalog />
    </div>
  );
}
