import { Router } from 'express';
import { getAuthStatus } from '../services/graph';

const router = Router();

router.get('/status', async (req, res) => {
  res.json(await getAuthStatus());
});

export default router;
