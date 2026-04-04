import { useEffect, useRef } from 'react';
import { useForgeEvents } from '../contexts/WebSocketContext';
import { useToast } from './Toast';

/**
 * Listens to the shared WebSocket event stream and fires toast notifications
 * for key async events: execution complete, warning+/critical findings,
 * and ticket status changes.
 *
 * Render this once inside App (inside both ToastProvider and WebSocketProvider).
 */
export default function WsToastBridge() {
  const { lastEvent } = useForgeEvents();
  const { addToast } = useToast();
  const lastEventRef = useRef<typeof lastEvent>(null);

  useEffect(() => {
    if (!lastEvent) return;
    // De-duplicate: skip if same event reference
    if (lastEvent === lastEventRef.current) return;
    lastEventRef.current = lastEvent;

    const { category, event, data } = lastEvent;
    const eventType = (event as string) || (lastEvent.type as string) || '';

    // ── Execution complete ──
    if (category === 'execution' && (eventType === 'completed' || eventType === 'done')) {
      const agentName = (lastEvent.agentName as string) || 'Agent';
      addToast(`Execution complete — ${agentName}`, 'success', 5000);
      return;
    }

    // ── Warning / critical findings ──
    if (category === 'finding') {
      const severity = (lastEvent.severity as string) || ((data as Record<string, unknown>)?.severity as string) || '';
      const finding = (lastEvent.finding as string) || ((data as Record<string, unknown>)?.finding as string) || 'New finding';
      const short = finding.length > 80 ? `${finding.slice(0, 77)}…` : finding;

      if (severity === 'critical') {
        addToast(`Critical finding: ${short}`, 'error', 8000);
      } else if (severity === 'warning') {
        addToast(`Warning: ${short}`, 'info', 5000);
      }
      return;
    }

    // ── Ticket status changes ──
    if (category === 'ticket') {
      const ticketId = (lastEvent.ticketId as string) || ((data as Record<string, unknown>)?.id as string) || '';
      const status = (lastEvent.status as string) || ((data as Record<string, unknown>)?.status as string) || '';
      if (status) {
        const label = ticketId ? `Ticket ${ticketId}` : 'Ticket';
        addToast(`${label} → ${status}`, 'info', 5000);
      }
    }
  }, [lastEvent, addToast]);

  return null;
}
