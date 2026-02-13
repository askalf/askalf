import { useState, useRef, useEffect } from 'react';
import { useGitSpaceStore } from '../../stores/git-space';

/**
 * Simple markdown-to-HTML for review output:
 * - **bold**, *italic*, `code`, ```code blocks```
 * - Lists, headings
 */
function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="cr-review-code"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="cr-review-inline-code">$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<h4 class="cr-review-h">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="cr-review-h">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="cr-review-h">$1</h2>')
    // List items
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')
    // Single newlines
    .replace(/\n/g, '<br/>');

  // Wrap in paragraph
  html = '<p>' + html + '</p>';
  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  html = html.replace(/<\/ul><ul>/g, '');

  return html;
}

export default function ReviewChatPanel() {
  const reviewOpen = useGitSpaceStore((s) => s.reviewOpen);
  const setReviewOpen = useGitSpaceStore((s) => s.setReviewOpen);
  const reviewMessages = useGitSpaceStore((s) => s.reviewMessages);
  const reviewLoading = useGitSpaceStore((s) => s.reviewLoading);
  const reviewExecutionId = useGitSpaceStore((s) => s.reviewExecutionId);
  const requestAiReview = useGitSpaceStore((s) => s.requestAiReview);
  const sendReviewMessage = useGitSpaceStore((s) => s.sendReviewMessage);
  const selectedBranch = useGitSpaceStore((s) => s.selectedBranch);
  const reviewCompleted = useGitSpaceStore((s) => s.reviewCompleted);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasTriggeredRef = useRef(false);

  // Auto-trigger review on first open
  useEffect(() => {
    if (reviewOpen && reviewMessages.length === 0 && !hasTriggeredRef.current && selectedBranch) {
      hasTriggeredRef.current = true;
      requestAiReview();
    }
  }, [reviewOpen, reviewMessages.length, selectedBranch, requestAiReview]);

  // Reset trigger ref when branch changes
  useEffect(() => {
    hasTriggeredRef.current = false;
  }, [selectedBranch]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [reviewMessages.length]);

  if (!reviewOpen) return null;

  const handleSend = () => {
    if (!input.trim() || reviewLoading) return;
    sendReviewMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickActions = [
    { label: 'Full Review', prompt: 'Do a thorough code review. Check for bugs, security issues, performance problems, and code quality.', icon: 'review' },
    { label: 'Security', prompt: 'Focus on security: Are there any injection vulnerabilities, auth issues, or data exposure risks?', icon: 'security' },
    { label: 'Summarize', prompt: 'Give a concise 2-3 sentence summary of what these changes do and why.', icon: 'summary' },
    { label: 'Performance', prompt: 'Check for performance issues: N+1 queries, memory leaks, unnecessary computation, blocking calls.', icon: 'perf' },
  ];

  return (
    <>
      <div className="cr-review-overlay" onClick={() => setReviewOpen(false)} />
      <div className="cr-review-panel">
        <div className="cr-review-header">
          <div className="cr-review-header-left">
            <h3>AI Code Review</h3>
            {reviewCompleted && (
              <span className="cr-review-status-badge cr-review-status--done">Complete</span>
            )}
            {reviewLoading && (
              <span className="cr-review-status-badge cr-review-status--loading">Reviewing...</span>
            )}
          </div>
          <button className="cr-review-close" onClick={() => setReviewOpen(false)} aria-label="Close review panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Quick actions — shown before first review */}
        {reviewMessages.length === 0 && !reviewLoading && (
          <div className="cr-review-quick">
            <div className="cr-review-quick-label">Quick Actions</div>
            <div className="cr-review-quick-grid">
              {quickActions.map((a) => (
                <button
                  key={a.label}
                  className="cr-review-quick-btn"
                  onClick={() => sendReviewMessage(a.prompt)}
                  disabled={reviewLoading}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="cr-review-messages">
          {reviewMessages.map((msg, i) => (
            <div key={i} className={`cr-review-msg cr-review-msg--${msg.role}`}>
              <div className="cr-review-msg-role">
                {msg.role === 'user' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1 15l-4-4 1.41-1.41L11 14.17l6.59-6.59L19 9l-8 8z"/></svg>
                )}
                {msg.role === 'user' ? 'You' : 'AI Reviewer'}
              </div>
              {msg.role === 'assistant' ? (
                <div
                  className="cr-review-msg-content cr-review-msg-markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              ) : (
                <div className="cr-review-msg-content">{msg.content}</div>
              )}
            </div>
          ))}
          {reviewLoading && (
            <div className="cr-review-msg cr-review-msg--assistant">
              <div className="cr-review-msg-role">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1 15l-4-4 1.41-1.41L11 14.17l6.59-6.59L19 9l-8 8z"/></svg>
                AI Reviewer
              </div>
              <div className="cr-review-msg-content cr-review-typing">
                <div className="cr-typing-dots">
                  <span /><span /><span />
                </div>
                {reviewExecutionId ? 'Analyzing code changes...' : 'Starting review...'}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="cr-review-input-area">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the code changes..."
            rows={2}
            disabled={reviewLoading}
          />
          <button
            className="cr-btn cr-btn--primary cr-review-send"
            onClick={handleSend}
            disabled={!input.trim() || reviewLoading}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </>
  );
}
