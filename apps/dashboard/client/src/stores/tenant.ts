import { create } from 'zustand';
import { API_BASE } from '../utils/api';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  type: string;
  icon: string | null;
  use_case: string | null;
  role: string;
}

interface TenantState {
  tenants: Tenant[];
  currentTenantId: string | null;
  loading: boolean;
  fetchTenants: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  createTenant: (name: string, type?: string, useCase?: string) => Promise<Tenant | null>;
}

export const useTenantStore = create<TenantState>((set, get) => ({
  tenants: [],
  currentTenantId: localStorage.getItem('askalf_tenant_id'),
  loading: false,

  fetchTenants: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/tenants`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { tenants: Tenant[] };
        set({ tenants: data.tenants });
        // Set default if none selected
        if (!get().currentTenantId && data.tenants.length > 0) {
          set({ currentTenantId: data.tenants[0]!.id });
          localStorage.setItem('askalf_tenant_id', data.tenants[0]!.id);
        }
      }
    } catch { /* ignore */ }
    set({ loading: false });
  },

  switchTenant: async (tenantId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/tenants/${tenantId}/switch`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        set({ currentTenantId: tenantId });
        localStorage.setItem('askalf_tenant_id', tenantId);
        // Reload page to refresh all data with new tenant context
        window.location.reload();
      }
    } catch { /* ignore */ }
  },

  createTenant: async (name: string, type?: string, useCase?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/tenants`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type: type || 'user', use_case: useCase }),
      });
      if (res.ok) {
        const data = await res.json() as { tenant: Tenant };
        await get().fetchTenants();
        return data.tenant;
      }
    } catch { /* ignore */ }
    return null;
  },
}));
