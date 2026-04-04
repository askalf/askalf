/**
 * API Key-based Integration Providers
 * Cloud, CI/CD, PM, Monitoring, and Storage integrations that use API keys
 * instead of OAuth flows.
 */

export type ApiKeyProvider =
  | 'aws' | 'gcp' | 'azure' | 'digitalocean'
  | 'vercel' | 'netlify' | 'railway' | 'flyio'
  | 'jira' | 'linear' | 'notion' | 'asana'
  | 'datadog' | 'sentry' | 'pagerduty' | 'grafana'
  | 'cloudflare' | 's3' | 'supabase'
  // CRM & Sales
  | 'salesforce' | 'hubspot' | 'pipedrive'
  // E-Commerce & Payments
  | 'shopify' | 'stripe' | 'woocommerce' | 'square'
  // Marketing & Ads
  | 'mailchimp' | 'google_ads' | 'meta_ads' | 'sendgrid'
  // Social Media
  | 'twitter' | 'instagram' | 'linkedin' | 'buffer'
  // Productivity & Docs
  | 'google_workspace' | 'microsoft365' | 'airtable' | 'google_sheets'
  // Analytics
  | 'google_analytics' | 'mixpanel' | 'plausible'
  // Finance & HR
  | 'quickbooks' | 'xero' | 'gusto' | 'wise';

export const API_KEY_PROVIDERS: ApiKeyProvider[] = [
  'aws', 'gcp', 'azure', 'digitalocean',
  'vercel', 'netlify', 'railway', 'flyio',
  'jira', 'linear', 'notion', 'asana',
  'datadog', 'sentry', 'pagerduty', 'grafana',
  'cloudflare', 's3', 'supabase',
  'salesforce', 'hubspot', 'pipedrive',
  'shopify', 'stripe', 'woocommerce', 'square',
  'mailchimp', 'google_ads', 'meta_ads', 'sendgrid',
  'twitter', 'instagram', 'linkedin', 'buffer',
  'google_workspace', 'microsoft365', 'airtable', 'google_sheets',
  'google_analytics', 'mixpanel', 'plausible',
  'quickbooks', 'xero', 'gusto', 'wise',
];

export interface ApiKeyProviderConfig {
  name: string;
  category: string;
  requiredFields: { key: string; label: string; sensitive?: boolean }[];
  testEndpoint?: string;
  testHeaders?: (config: Record<string, string>) => Record<string, string | undefined>;
}

export const PROVIDER_CONFIGS: Record<ApiKeyProvider, ApiKeyProviderConfig> = {
  aws: {
    name: 'AWS',
    category: 'cloud',
    requiredFields: [
      { key: 'access_key_id', label: 'Access Key ID' },
      { key: 'secret_access_key', label: 'Secret Access Key', sensitive: true },
      { key: 'region', label: 'Default Region' },
    ],
    testEndpoint: 'https://sts.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15',
  },
  gcp: {
    name: 'Google Cloud',
    category: 'cloud',
    requiredFields: [
      { key: 'service_account_json', label: 'Service Account JSON', sensitive: true },
      { key: 'project_id', label: 'Project ID' },
    ],
  },
  azure: {
    name: 'Azure',
    category: 'cloud',
    requiredFields: [
      { key: 'tenant_id', label: 'Tenant ID' },
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', sensitive: true },
      { key: 'subscription_id', label: 'Subscription ID' },
    ],
  },
  digitalocean: {
    name: 'DigitalOcean',
    category: 'cloud',
    requiredFields: [
      { key: 'api_token', label: 'API Token', sensitive: true },
    ],
    testEndpoint: 'https://api.digitalocean.com/v2/account',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_token']}` }),
  },
  vercel: {
    name: 'Vercel',
    category: 'cicd',
    requiredFields: [
      { key: 'api_token', label: 'API Token', sensitive: true },
      { key: 'team_id', label: 'Team ID (optional)' },
    ],
    testEndpoint: 'https://api.vercel.com/v2/user',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_token']}` }),
  },
  netlify: {
    name: 'Netlify',
    category: 'cicd',
    requiredFields: [
      { key: 'api_token', label: 'Personal Access Token', sensitive: true },
    ],
    testEndpoint: 'https://api.netlify.com/api/v1/user',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_token']}` }),
  },
  railway: {
    name: 'Railway',
    category: 'cicd',
    requiredFields: [
      { key: 'api_token', label: 'API Token', sensitive: true },
    ],
    testEndpoint: 'https://backboard.railway.app/graphql/v2',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_token']}` }),
  },
  flyio: {
    name: 'Fly.io',
    category: 'cicd',
    requiredFields: [
      { key: 'api_token', label: 'API Token', sensitive: true },
      { key: 'org_slug', label: 'Organization Slug' },
    ],
    testEndpoint: 'https://api.machines.dev/v1/apps',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_token']}` }),
  },
  jira: {
    name: 'Jira',
    category: 'pm',
    requiredFields: [
      { key: 'domain', label: 'Jira Domain (e.g., mycompany.atlassian.net)' },
      { key: 'email', label: 'Email Address' },
      { key: 'api_token', label: 'API Token', sensitive: true },
    ],
    testHeaders: (c) => ({ 'Authorization': `Basic ${Buffer.from(`${c['email']}:${c['api_token']}`).toString('base64')}` }),
  },
  linear: {
    name: 'Linear',
    category: 'pm',
    requiredFields: [
      { key: 'api_key', label: 'API Key', sensitive: true },
    ],
    testEndpoint: 'https://api.linear.app/graphql',
    testHeaders: (c) => ({ 'Authorization': c['api_key'] }),
  },
  notion: {
    name: 'Notion',
    category: 'pm',
    requiredFields: [
      { key: 'api_key', label: 'Integration Token', sensitive: true },
    ],
    testEndpoint: 'https://api.notion.com/v1/users/me',
    testHeaders: (c) => ({
      'Authorization': `Bearer ${c['api_key']}`,
      'Notion-Version': '2022-06-28',
    }),
  },
  asana: {
    name: 'Asana',
    category: 'pm',
    requiredFields: [
      { key: 'api_token', label: 'Personal Access Token', sensitive: true },
    ],
    testEndpoint: 'https://app.asana.com/api/1.0/users/me',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_token']}` }),
  },
  datadog: {
    name: 'Datadog',
    category: 'monitoring',
    requiredFields: [
      { key: 'api_key', label: 'API Key', sensitive: true },
      { key: 'app_key', label: 'Application Key', sensitive: true },
      { key: 'site', label: 'Datadog Site (e.g., datadoghq.com)' },
    ],
    testHeaders: (c) => ({
      'DD-API-KEY': c['api_key'],
      'DD-APPLICATION-KEY': c['app_key'],
    }),
  },
  sentry: {
    name: 'Sentry',
    category: 'monitoring',
    requiredFields: [
      { key: 'auth_token', label: 'Auth Token', sensitive: true },
      { key: 'org_slug', label: 'Organization Slug' },
    ],
    testEndpoint: 'https://sentry.io/api/0/organizations/',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['auth_token']}` }),
  },
  pagerduty: {
    name: 'PagerDuty',
    category: 'monitoring',
    requiredFields: [
      { key: 'api_key', label: 'API Key', sensitive: true },
    ],
    testEndpoint: 'https://api.pagerduty.com/users/me',
    testHeaders: (c) => ({
      'Authorization': `Token token=${c['api_key']}`,
      'Content-Type': 'application/json',
    }),
  },
  grafana: {
    name: 'Grafana',
    category: 'monitoring',
    requiredFields: [
      { key: 'url', label: 'Grafana URL' },
      { key: 'api_key', label: 'API Key / Service Account Token', sensitive: true },
    ],
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_key']}` }),
  },
  cloudflare: {
    name: 'Cloudflare',
    category: 'storage',
    requiredFields: [
      { key: 'api_token', label: 'API Token', sensitive: true },
      { key: 'account_id', label: 'Account ID' },
    ],
    testEndpoint: 'https://api.cloudflare.com/client/v4/user/tokens/verify',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_token']}` }),
  },
  s3: {
    name: 'Amazon S3',
    category: 'storage',
    requiredFields: [
      { key: 'access_key_id', label: 'Access Key ID' },
      { key: 'secret_access_key', label: 'Secret Access Key', sensitive: true },
      { key: 'region', label: 'Region' },
      { key: 'bucket', label: 'Default Bucket' },
    ],
  },
  supabase: {
    name: 'Supabase',
    category: 'storage',
    requiredFields: [
      { key: 'url', label: 'Project URL' },
      { key: 'anon_key', label: 'Anon Key' },
      { key: 'service_role_key', label: 'Service Role Key', sensitive: true },
    ],
    testHeaders: (c) => ({
      'apikey': c['anon_key'],
      'Authorization': `Bearer ${c['anon_key']}`,
    }),
  },

  // ── CRM & Sales ──
  salesforce: {
    name: 'Salesforce',
    category: 'crm',
    requiredFields: [
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', sensitive: true },
      { key: 'instance_url', label: 'Instance URL' },
    ],
  },
  hubspot: {
    name: 'HubSpot',
    category: 'crm',
    requiredFields: [
      { key: 'api_key', label: 'Private App Token', sensitive: true },
    ],
    testEndpoint: 'https://api.hubapi.com/crm/v3/objects/contacts?limit=1',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_key']}` }),
  },
  pipedrive: {
    name: 'Pipedrive',
    category: 'crm',
    requiredFields: [
      { key: 'api_token', label: 'API Token', sensitive: true },
      { key: 'domain', label: 'Company Domain' },
    ],
  },

  // ── E-Commerce & Payments ──
  shopify: {
    name: 'Shopify',
    category: 'ecommerce',
    requiredFields: [
      { key: 'store_url', label: 'Store URL' },
      { key: 'api_key', label: 'Admin API Access Token', sensitive: true },
    ],
    testHeaders: (c) => ({ 'X-Shopify-Access-Token': c['api_key'] }),
  },
  stripe: {
    name: 'Stripe',
    category: 'ecommerce',
    requiredFields: [
      { key: 'secret_key', label: 'Secret Key', sensitive: true },
    ],
    testEndpoint: 'https://api.stripe.com/v1/balance',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['secret_key']}` }),
  },
  woocommerce: {
    name: 'WooCommerce',
    category: 'ecommerce',
    requiredFields: [
      { key: 'url', label: 'Store URL' },
      { key: 'consumer_key', label: 'Consumer Key' },
      { key: 'consumer_secret', label: 'Consumer Secret', sensitive: true },
    ],
  },
  square: {
    name: 'Square',
    category: 'ecommerce',
    requiredFields: [
      { key: 'access_token', label: 'Access Token', sensitive: true },
      { key: 'environment', label: 'Environment' },
    ],
    testEndpoint: 'https://connect.squareup.com/v2/locations',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['access_token']}` }),
  },

  // ── Marketing & Ads ──
  mailchimp: {
    name: 'Mailchimp',
    category: 'marketing',
    requiredFields: [
      { key: 'api_key', label: 'API Key', sensitive: true },
      { key: 'server_prefix', label: 'Server Prefix' },
    ],
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_key']}` }),
  },
  google_ads: {
    name: 'Google Ads',
    category: 'marketing',
    requiredFields: [
      { key: 'developer_token', label: 'Developer Token', sensitive: true },
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', sensitive: true },
    ],
  },
  meta_ads: {
    name: 'Meta Ads',
    category: 'marketing',
    requiredFields: [
      { key: 'access_token', label: 'Long-Lived Access Token', sensitive: true },
      { key: 'ad_account_id', label: 'Ad Account ID' },
    ],
    testEndpoint: 'https://graph.facebook.com/v18.0/me',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['access_token']}` }),
  },
  sendgrid: {
    name: 'SendGrid',
    category: 'marketing',
    requiredFields: [
      { key: 'api_key', label: 'API Key', sensitive: true },
    ],
    testEndpoint: 'https://api.sendgrid.com/v3/user/profile',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_key']}` }),
  },

  // ── Social Media ──
  twitter: {
    name: 'X / Twitter',
    category: 'social',
    requiredFields: [
      { key: 'api_key', label: 'API Key (Consumer Key)' },
      { key: 'api_secret', label: 'API Secret (Consumer Secret)', sensitive: true },
      { key: 'bearer_token', label: 'Bearer Token', sensitive: true },
      { key: 'access_token', label: 'Access Token' },
      { key: 'access_token_secret', label: 'Access Token Secret', sensitive: true },
    ],
    testEndpoint: 'https://api.twitter.com/2/users/me',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['bearer_token']}` }),
  },
  instagram: {
    name: 'Instagram',
    category: 'social',
    requiredFields: [
      { key: 'access_token', label: 'Long-Lived Access Token', sensitive: true },
    ],
  },
  linkedin: {
    name: 'LinkedIn',
    category: 'social',
    requiredFields: [
      { key: 'access_token', label: 'Access Token', sensitive: true },
    ],
    testEndpoint: 'https://api.linkedin.com/v2/me',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['access_token']}` }),
  },
  buffer: {
    name: 'Buffer',
    category: 'social',
    requiredFields: [
      { key: 'access_token', label: 'Access Token', sensitive: true },
    ],
    testEndpoint: 'https://api.bufferapp.com/1/user.json',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['access_token']}` }),
  },

  // ── Productivity & Docs ──
  google_workspace: {
    name: 'Google Workspace',
    category: 'productivity',
    requiredFields: [
      { key: 'service_account_json', label: 'Service Account JSON', sensitive: true },
    ],
  },
  microsoft365: {
    name: 'Microsoft 365',
    category: 'productivity',
    requiredFields: [
      { key: 'tenant_id', label: 'Tenant ID' },
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', sensitive: true },
    ],
  },
  airtable: {
    name: 'Airtable',
    category: 'productivity',
    requiredFields: [
      { key: 'api_key', label: 'Personal Access Token', sensitive: true },
    ],
    testEndpoint: 'https://api.airtable.com/v0/meta/whoami',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_key']}` }),
  },
  google_sheets: {
    name: 'Google Sheets',
    category: 'productivity',
    requiredFields: [
      { key: 'service_account_json', label: 'Service Account JSON', sensitive: true },
    ],
  },

  // ── Analytics ──
  google_analytics: {
    name: 'Google Analytics',
    category: 'analytics',
    requiredFields: [
      { key: 'property_id', label: 'Property ID' },
      { key: 'service_account_json', label: 'Service Account JSON', sensitive: true },
    ],
  },
  mixpanel: {
    name: 'Mixpanel',
    category: 'analytics',
    requiredFields: [
      { key: 'project_token', label: 'Project Token' },
      { key: 'api_secret', label: 'API Secret', sensitive: true },
    ],
  },
  plausible: {
    name: 'Plausible',
    category: 'analytics',
    requiredFields: [
      { key: 'api_key', label: 'API Key', sensitive: true },
      { key: 'site_id', label: 'Site ID' },
    ],
    testEndpoint: 'https://plausible.io/api/v1/stats/realtime/visitors',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_key']}` }),
  },

  // ── Finance & HR ──
  quickbooks: {
    name: 'QuickBooks',
    category: 'finance',
    requiredFields: [
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', sensitive: true },
      { key: 'realm_id', label: 'Company ID' },
    ],
  },
  xero: {
    name: 'Xero',
    category: 'finance',
    requiredFields: [
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', sensitive: true },
    ],
  },
  gusto: {
    name: 'Gusto',
    category: 'finance',
    requiredFields: [
      { key: 'api_token', label: 'API Token', sensitive: true },
    ],
  },
  wise: {
    name: 'Wise',
    category: 'finance',
    requiredFields: [
      { key: 'api_token', label: 'API Token', sensitive: true },
      { key: 'profile_id', label: 'Profile ID' },
    ],
    testEndpoint: 'https://api.wise.com/v1/profiles',
    testHeaders: (c) => ({ 'Authorization': `Bearer ${c['api_token']}` }),
  },
};

/**
 * Test an API key integration by calling its test endpoint.
 */
export async function testApiKeyIntegration(
  provider: ApiKeyProvider,
  config: Record<string, string>,
): Promise<{ success: boolean; message: string; username?: string }> {
  const providerConfig = PROVIDER_CONFIGS[provider];
  if (!providerConfig) {
    return { success: false, message: `Unknown provider: ${provider}` };
  }

  // Check required fields
  for (const field of providerConfig.requiredFields) {
    if (!config[field.key] && field.key !== 'team_id' && field.key !== 'org_slug' && !field.label.includes('optional')) {
      return { success: false, message: `Missing required field: ${field.label}` };
    }
  }

  if (!providerConfig.testEndpoint || !providerConfig.testHeaders) {
    // No test endpoint — just validate fields are present
    return { success: true, message: 'Configuration saved (no validation endpoint available)' };
  }

  try {
    let url = providerConfig.testEndpoint;
    // For providers with domain-based URLs
    if (provider === 'jira' && config['domain']) {
      url = `https://${config['domain']}/rest/api/3/myself`;
    }
    if (provider === 'grafana' && config['url']) {
      url = `${config['url'].replace(/\/$/, '')}/api/org`;
    }

    const headers = providerConfig.testHeaders(config);
    const response = await fetch(url, {
      method: provider === 'linear' ? 'POST' : 'GET',
      headers: {
        ...headers,
        ...(provider === 'linear' ? {
          'Content-Type': 'application/json',
        } : {}),
      },
      ...(provider === 'linear' ? {
        body: JSON.stringify({ query: '{ viewer { id name } }' }),
      } : {}),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      return { success: true, message: `Connected to ${providerConfig.name}` };
    }

    return {
      success: false,
      message: `${providerConfig.name} returned ${response.status}: ${response.statusText}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Connection failed: ${err instanceof Error ? err.message : 'Network error'}`,
    };
  }
}

export function isApiKeyProvider(name: string): name is ApiKeyProvider {
  return API_KEY_PROVIDERS.includes(name as ApiKeyProvider);
}
