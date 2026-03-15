import { Router } from 'express';
import { getTodayCalendar, getUpcomingCalendar, getAuthStatus } from '../services/graph';

const router = Router();

router.get('/today', async (req, res) => {
  try {
    const status = await getAuthStatus();
    if (!status.authenticated) {
      return res.status(401).json({ error: 'Not authenticated with Outlook' });
    }
    const events = await getTodayCalendar();
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/upcoming', async (req, res) => {
  try {
    const status = await getAuthStatus();
    if (!status.authenticated) {
      return res.status(401).json({ error: 'Not authenticated with Outlook' });
    }
    const days = parseInt(req.query.days as string) || 7;
    const events = await getUpcomingCalendar(days);
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
