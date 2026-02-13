import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'small' | 'medium' | 'large';
}

export default function Modal({ title, onClose, children, size = 'medium' }: ModalProps) {
  return (
    <div className="hub-modal-overlay" onClick={onClose}>
      <div className={`hub-modal hub-modal--${size}`} onClick={(e) => e.stopPropagation()}>
        <div className="hub-modal__header">
          <h2>{title}</h2>
          <button className="hub-modal__close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="hub-modal__body">
          {children}
        </div>
      </div>
    </div>
  );
}
