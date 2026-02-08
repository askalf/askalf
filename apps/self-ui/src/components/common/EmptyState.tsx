interface Props {
  icon: string;
  title: string;
  text?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, text, action }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      {text && <div className="empty-state-text">{text}</div>}
      {action}
    </div>
  );
}
