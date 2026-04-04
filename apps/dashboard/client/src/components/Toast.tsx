import { createContext, useContext, useCallback, useState, useRef } from 'react';
import './Toast.css';

// ── Types ──

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting: boolean;
  duration: number;
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

// ── Constants ──

const MAX_TOASTS = 3;
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 5000,
  error: 8000,
  warning: 5000,
  info: 5000,
};

const ICON: Record<ToastType, string> = {
  success: '\u2713',  // ✓
  error: '!',
  warning: '\u26a0',  // ⚠
  info: 'i',
};

// ── Provider ──

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 250);
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType, duration?: number) => {
      const id = nextId.current++;
      const ms = duration ?? DEFAULT_DURATION[type];

      setToasts((prev) => {
        const next = [...prev, { id, message, type, exiting: false, duration: ms }];
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
          <div
            key={t.id}
            className={`toast toast--${t.type}${t.exiting ? ' toast-exit' : ''}`}
          >
            <div className="toast-accent" />
            <div className="toast-body">
              <span className="toast-icon">{ICON[t.type]}</span>
              <span className="toast-msg">{t.message}</span>
              <button className="toast-close" onClick={() => removeToast(t.id)}>
                &times;
              </button>
            </div>
            <div
              className="toast-progress"
              style={{ '--toast-duration': `${t.duration}ms` } as React.CSSProperties}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
