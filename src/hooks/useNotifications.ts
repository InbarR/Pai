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
      // Only show in-app bubble if window is visible
      setBubble({
        id: `reminder-${data.id}-${Date.now()}`,
        message: `Reminder: **${data.title}**`,
        detail: data.description || new Date(data.dueAt).toLocaleString(),
        reminderId: data.id,
      });
    });

    eventSource.addEventListener('meeting-soon', (event) => {
      const data = JSON.parse(event.data);
      const startTime = new Date(data.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Only show in-app bubble — native OS notification is handled by Electron main process
      setBubble({
        id: `meeting-${Date.now()}`,
        message: `Meeting soon: **${data.subject}**`,
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
