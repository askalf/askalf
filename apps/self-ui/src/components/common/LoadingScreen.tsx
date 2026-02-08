interface Props {
  message?: string;
}

export default function LoadingScreen({ message }: Props) {
  return (
    <div className="loading-screen">
      <div className="loading-dot" />
      {message && <div className="loading-message">{message}</div>}
    </div>
  );
}
