export default function TypingIndicator() {
  return (
    <div className="message message-assistant animate-message-alf">
      <div className="message-avatar">
        <span className="message-avatar-icon animate-glow-pulse">👽</span>
      </div>
      <div className="message-content-wrapper">
        <div className="message-content">
          <div className="typing-indicator">
            <span className="typing-dot animate-typing-dot" style={{ animationDelay: '-0.32s' }} />
            <span className="typing-dot animate-typing-dot" style={{ animationDelay: '-0.16s' }} />
            <span className="typing-dot animate-typing-dot" style={{ animationDelay: '0s' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
