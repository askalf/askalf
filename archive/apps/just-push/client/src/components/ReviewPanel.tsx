import { useState, useRef, useEffect } from 'react';
import { useBranchStore } from '../stores/branches';

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="jp-review-code"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="jp-review-inline">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>').replace(/<\/ul><ul>/g, '');
  return html;
}

const QUICK_ACTIONS = [
  { label: 'Full Review', prompt: 'Do a thorough code review. Check for bugs, security issues, performance problems, and code quality.' },
  { label: 'Security', prompt: 'Focus on security: injection vulnerabilities, auth issues, data exposure risks.' },
  { label: 'Summarize', prompt: 'Give a concise 2-3 sentence summary of what these changes do and why.' },
  { label: 'Performance', prompt: 'Check for performance issues: N+1 queries, memory leaks, blocking calls.' },
];

export default function ReviewPanel() {
  const reviewMessages = useBranchStore((s) => s.reviewMessages);
  const reviewLoading = useBranchStore((s) => s.reviewLoading);
  const reviewCompleted = useBranchStore((s) => s.reviewCompleted);
  const reviewExecutionId = useBranchStore((s) => s.reviewExecutionId);
  const requestAiReview = useBranchStore((s) => s.requestAiReview);
  const sendReviewMessage = useBranchStore((s) => s.sendReviewMessage);
  const selectedBranch = useBranchStore((s) => s.selectedBranch);

  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const triggeredRef = useRef(false);

  // Auto-trigger on first expand if no messages
  useEffect(() => {
    if (reviewMessages.length === 0 && !triggeredRef.current && selectedBranch) {
      triggeredRef.current = true;
      requestAiReview();
    }
  }, [reviewMessages.length, selectedBranch, requestAiReview]);

  useEffect(() => { triggeredRef.current = false; }, [selectedBranch]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [reviewMessages.length]);

  const handleSend = () => {
    if (!input.trim() || reviewLoading) return;
    sendReviewMessage(input.trim());
    setInput('');
  };

  return (
    <div className="jp-review">
      {/* Status */}
      <div className="jp-review-status">
        {reviewCompleted && <span className="jp-pill jp-pill--success">Complete</span>}
        {reviewLoading && <span className="jp-pill jp-pill--warning">Analyzing...</span>}
      </div>

      {/* Quick actions (before first review) */}
      {reviewMessages.length === 0 && !reviewLoading && (
        <div className="jp-review-quick">
          <p className="jp-review-quick-label">Quick Actions</p>
          <div className="jp-review-quick-grid">
            {QUICK_ACTIONS.map((a) => (
              <button key={a.label} className="jp-review-quick-btn" onClick={() => sendReviewMessage(a.prompt)} disabled={reviewLoading}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="jp-review-messages">
        {reviewMessages.map((msg, i) => (
          <div key={i} className={`jp-review-msg jp-review-msg--${msg.role}`}>
            <div className="jp-review-msg-role">{msg.role === 'user' ? 'You' : 'AI Reviewer'}</div>
            {msg.role === 'assistant' ? (
              <div className="jp-review-msg-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            ) : (
              <div className="jp-review-msg-body">{msg.content}</div>
            )}
          </div>
        ))}
        {reviewLoading && (
          <div className="jp-review-msg jp-review-msg--assistant">
            <div className="jp-review-msg-role">AI Reviewer</div>
            <div className="jp-review-msg-body jp-review-typing">
              <span className="jp-typing-dot" /><span className="jp-typing-dot" /><span className="jp-typing-dot" />
              {reviewExecutionId ? 'Analyzing code changes...' : 'Starting review...'}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="jp-review-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Ask about the code changes..."
          rows={2}
          disabled={reviewLoading}
        />
        <button className="jp-review-send" onClick={handleSend} disabled={!input.trim() || reviewLoading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  );
}
