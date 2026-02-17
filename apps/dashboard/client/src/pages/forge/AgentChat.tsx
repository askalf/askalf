import { useState, useEffect, useRef } from 'react';
import { useHubStore } from '../../stores/hub';
import { hubApi } from '../../hooks/useHubApi';
import './forge-observe.css';

interface ChatMessage {
  id: string;
  agentName: string;
  role: 'agent' | 'moderator' | 'system';
  content: string;
  timestamp: string;
}

interface ChatSession {
  id: string;
  topic: string;
  status: string;
  agents: string[];
  messages: ChatMessage[];
}

export default function AgentChat() {
  const agents = useHubStore((s) => s.agents);
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const [sessions, setSessions] = useState<Array<{ id: string; topic: string; status: string; agentCount: number; messageCount: number }>>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [topic, setTopic] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchAgents(); loadSessions(); }, [fetchAgents]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeSession?.messages]);

  const loadSessions = async () => {
    try {
      const data = await hubApi.chat.sessions() as typeof sessions;
      setSessions(data);
    } catch { /* ignore */ }
  };

  const createSession = async () => {
    if (!topic.trim() || selectedAgents.length < 2) return;
    setLoading(true);
    try {
      const session = await hubApi.chat.create(topic, selectedAgents) as ChatSession;
      setActiveSession(session);
      setTopic('');
      setSelectedAgents([]);
      await loadSessions();
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadSession = async (id: string) => {
    try {
      const session = await hubApi.chat.get(id) as ChatSession;
      setActiveSession(session);
    } catch (err) { console.error(err); }
  };

  const sendMessage = async () => {
    if (!activeSession || !message.trim()) return;
    try {
      await hubApi.chat.message(activeSession.id, message);
      setMessage('');
      await loadSession(activeSession.id);
    } catch (err) { console.error(err); }
  };

  const runRound = async () => {
    if (!activeSession) return;
    setLoading(true);
    try {
      await hubApi.chat.round(activeSession.id);
      await loadSession(activeSession.id);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const endSession = async () => {
    if (!activeSession) return;
    try {
      await hubApi.chat.end(activeSession.id);
      await loadSession(activeSession.id);
      await loadSessions();
    } catch (err) { console.error(err); }
  };

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
  };

  return (
    <div className="fo-overview" style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '16px', height: 'calc(100vh - 200px)' }}>
      {/* Sidebar */}
      <div style={{ borderRight: '1px solid rgba(255,255,255,0.06)', paddingRight: '12px', overflow: 'auto' }}>
        <h4 style={{ fontSize: '13px', marginBottom: '12px' }}>Sessions</h4>
        {sessions.map((s) => (
          <div key={s.id} onClick={() => loadSession(s.id)} className="fo-card" style={{ marginBottom: '6px', cursor: 'pointer', padding: '8px', fontSize: '12px' }}>
            <div style={{ fontWeight: 600 }}>{s.topic}</div>
            <div style={{ opacity: 0.5 }}>{s.agentCount} agents, {s.messageCount} msgs</div>
            <span className={`hub-badge hub-badge--${s.status === 'active' ? 'success' : 'default'}`} style={{ fontSize: '10px' }}>{s.status}</span>
          </div>
        ))}
        <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)', margin: '12px 0' }} />
        <h4 style={{ fontSize: '13px', marginBottom: '8px' }}>New Chat</h4>
        <input type="text" placeholder="Topic..." value={topic} onChange={(e) => setTopic(e.target.value)} style={{ width: '100%', marginBottom: '8px', fontSize: '12px' }} />
        <div style={{ fontSize: '11px', marginBottom: '4px' }}>Select 2+ agents:</div>
        {agents.filter((a) => !a.is_decommissioned).map((a) => (
          <label key={a.id} style={{ display: 'flex', gap: '4px', fontSize: '11px', marginBottom: '2px', cursor: 'pointer' }}>
            <input type="checkbox" checked={selectedAgents.includes(a.id)} onChange={() => toggleAgent(a.id)} />
            {a.name}
          </label>
        ))}
        <button className="hub-btn hub-btn--primary hub-btn--sm" onClick={createSession} disabled={loading || !topic.trim() || selectedAgents.length < 2} style={{ marginTop: '8px', width: '100%' }}>
          Start Chat
        </button>
      </div>

      {/* Chat area */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!activeSession ? (
          <div className="fo-empty">Select or create a chat session</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3 style={{ fontSize: '15px' }}>{activeSession.topic}</h3>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="hub-btn hub-btn--sm" onClick={runRound} disabled={loading || activeSession.status !== 'active'}>
                  {loading ? 'Running...' : 'Run Round'}
                </button>
                {activeSession.status === 'active' && (
                  <button className="hub-btn hub-btn--sm" onClick={endSession}>End</button>
                )}
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', marginBottom: '8px' }}>
              {activeSession.messages.map((msg) => (
                <div key={msg.id} style={{
                  marginBottom: '8px', padding: '8px 12px', borderRadius: '8px',
                  background: msg.role === 'moderator' ? 'rgba(99,102,241,0.1)' : msg.role === 'system' ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.05)',
                  borderLeft: msg.role === 'moderator' ? '3px solid #6366f1' : msg.role === 'system' ? '3px solid rgba(255,255,255,0.1)' : '3px solid #4ade80',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', opacity: 0.7 }}>
                    {msg.agentName} <span style={{ fontWeight: 400, opacity: 0.5 }}>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div style={{ fontSize: '13px', whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            {activeSession.status === 'active' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text" value={message} onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Send a message as moderator..."
                  style={{ flex: 1, fontSize: '13px' }}
                />
                <button className="hub-btn hub-btn--primary hub-btn--sm" onClick={sendMessage} disabled={!message.trim()}>Send</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
