import { create } from 'zustand';

interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

interface NotificationState {
  notifications: Notification[];
  add: (type: Notification['type'], message: string) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

let nextId = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  add: (type, message) => {
    const id = String(++nextId);
    set((s) => ({
      notifications: [...s.notifications, { id, type, message, timestamp: Date.now() }],
    }));
    // Auto-dismiss after 5s
    setTimeout(() => {
      set((s) => ({
        notifications: s.notifications.filter((n) => n.id !== id),
      }));
    }, 5000);
  },

  dismiss: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    })),

  clear: () => set({ notifications: [] }),
}));
