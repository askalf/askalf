interface EmptyStateProps {
  icon: string;
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="hub-empty">
      <div className="hub-empty__icon">{icon}</div>
      <h3 className="hub-empty__title">{title}</h3>
      <p className="hub-empty__message">{message}</p>
      {action && (
        <button className="hub-btn hub-btn--primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
