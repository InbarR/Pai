import { useEffect, useState } from 'react';

export interface PaiBubble {
  id: string;
  message: string;
  detail: string;
  reminderId?: number;
}

export function useNotifications() {
  const [bubble, setBubble] = useState<PaiBubble | null>(null);

  useEffect(() => {
    const eventSource = new EventSource('/api/notifications/stream');

    eventSource.addEventListener('reminder-due', (event) => {
      const data = JSON.parse(event.data);

      // Switch to chat mode
      window.dispatchEvent(new Event('pai-show-chat'));

      // Pai chat bubble
      setBubble({
        id: `reminder-${data.id}-${Date.now()}`,
        message: `Hey! Just a reminder: **${data.title}**`,
        detail: data.description || new Date(data.dueAt).toLocaleString(),
        reminderId: data.id,
      });
    });

    eventSource.onerror = () => {
      console.log('[SSE] Connection error, will retry...');
    };

    return () => eventSource.close();
  }, []);

  return { bubble, dismissBubble: () => setBubble(null) };
}
