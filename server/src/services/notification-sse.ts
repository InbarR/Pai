import { Request, Response, Router } from 'express';

const router = Router();
const clients: Set<Response> = new Set();

router.get('/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write('data: connected\n\n');
  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
});

export function broadcast(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

export default router;
