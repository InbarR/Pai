import { useEffect, useState } from 'react';

export interface PaiBubble {
  id: string;
  message: string;
  detail: string;
  reminderId?: number;
  joinUrl?: string;
  links?: string[];
}

export function useNotifications() {
  const [bubble, setBubble] = useState<PaiBubble | null>(null);

  useEffect(() => {
    const eventSource = new EventSource('/api/notifications/stream');

    eventSource.addEventListener('reminder-due', (event) => {
      const data = JSON.parse(event.data);
      window.dispatchEvent(new Event('pai-show-chat'));
      setBubble({
        id: `reminder-${data.id}-${Date.now()}`,
        message: `Hey! Just a reminder: **${data.title}**`,
        detail: data.description || new Date(data.dueAt).toLocaleString(),
        reminderId: data.id,
      });
    });

    eventSource.addEventListener('meeting-soon', (event) => {
      const data = JSON.parse(event.data);
      window.dispatchEvent(new Event('pai-show-chat'));
      const startTime = new Date(data.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setBubble({
        id: `meeting-${Date.now()}`,
        message: `Meeting starting soon: **${data.subject}**`,
        detail: `${startTime}${data.location ? ' — ' + data.location : ''}${data.organizer ? ' (by ' + data.organizer + ')' : ''}`,
        joinUrl: data.joinUrl,
        links: data.links,
      });
    });

    eventSource.onerror = () => {
      console.log('[SSE] Connection error, will retry...');
    };

    return () => eventSource.close();
  }, []);

  return { bubble, dismissBubble: () => setBubble(null) };
}
