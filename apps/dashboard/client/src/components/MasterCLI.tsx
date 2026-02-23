import { useState, useRef, useEffect, useCallback } from 'react';
import './MasterCLI.css';

const getApiBase = () => {
  const host = window.location.hostname;
  if (host.includes('orcastr8r.com') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  return 'http://localhost:3001';
};

interface CLILine {
  type: 'input' | 'output' | 'error' | 'system';
  text: string;
  timestamp: number;
}

export default function MasterCLI() {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<CLILine[]>([
    { type: 'system', text: 'Orcastr8r CLI v1.0 — Agent orchestration terminal', timestamp: Date.now() },
    { type: 'system', text: 'Examples: "show agent status", "run sentinel", "list open tickets"', timestamp: Date.now() },
  ]);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addLine = useCallback((type: CLILine['type'], text: string) => {
    setLines(prev => [...prev, { type, text, timestamp: Date.now() }]);
  }, []);

  const executeCommand = useCallback(async (command: string) => {
    if (!command.trim()) return;

    addLine('input', `> ${command}`);
    setHistory(prev => [command, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setInput('');
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${getApiBase()}/api/v1/forge/cli`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text().catch(() => 'Request failed');
        addLine('error', err);
        setRunning(false);
        return;
      }

      // Check if SSE stream
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) { addLine('error', 'No response stream'); setRunning(false); return; }

        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const eventLines = buffer.split('\n');
          buffer = eventLines.pop() || '';
          for (const line of eventLines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'output' || data.type === 'result') {
                  addLine('output', data.text || data.result || JSON.stringify(data));
                } else if (data.type === 'error') {
                  addLine('error', data.text || data.error || 'Unknown error');
                } else if (data.type === 'done') {
                  // Stream complete
                }
              } catch {
                addLine('output', line.slice(6));
              }
            }
          }
        }
      } else {
        // JSON response
        const data = await res.json();
        if (data.result) {
          addLine('output', typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2));
        } else if (data.error) {
          addLine('error', data.error);
        } else {
          addLine('output', JSON.stringify(data, null, 2));
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addLine('error', `Error: ${(err as Error).message}`);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [addLine]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !running) {
      executeCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (e.key === 'c' && e.ctrlKey && running) {
      abortRef.current?.abort();
      addLine('system', '^C — aborted');
      setRunning(false);
    }
  };

  return (
    <div className="cli-container">
      <div className="cli-header">
        <span className="cli-title">Orcastr8r Terminal</span>
        {running && <span className="cli-status cli-status--running">Running...</span>}
      </div>
      <div className="cli-output" ref={outputRef}>
        {lines.map((line, i) => (
          <div key={i} className={`cli-line cli-line--${line.type}`}>
            <pre>{line.text}</pre>
          </div>
        ))}
      </div>
      <div className="cli-input-row">
        <span className="cli-prompt">$</span>
        <input
          ref={inputRef}
          className="cli-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={running ? 'Processing...' : 'Enter command...'}
          disabled={running}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
