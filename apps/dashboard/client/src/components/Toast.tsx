import { createContext, useContext, useCallback, useState, useRef } from 'react';
import './Toast.css';

// ── Types ──

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting: boolean;
}

interface ToastContextValue {
  addToast: (message: string, type: ToastType, duration?: number) => void;
}

// ── Context ──

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ── Provider ──

const MAX_TOASTS = 3;
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 5000,
  error: 8000,
  info: 5000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200); // match animation duration
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType, duration?: number) => {
      const id = nextId.current++;
      const ms = duration ?? DEFAULT_DURATION[type];

      setToasts((prev) => {
        const next = [...prev, { id, message, type, exiting: false }];
        // Evict oldest if over max
        if (next.length > MAX_TOASTS) {
          return next.slice(next.length - MAX_TOASTS);
        }
        return next;
      });

      setTimeout(() => removeToast(id), ms);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}${t.exiting ? ' toast-exit' : ''}`}>
            <span className="toast-msg">{t.message}</span>
            <button className="toast-close" onClick={() => removeToast(t.id)}>
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
