import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const code = req.query.code || req.body?.code;

  if (!code || typeof code !== 'string' || code.length < 2 || code.length > 50) {
    return res.status(400).json({ error: 'Invalid household code' });
  }

  const key = `cc:${code.toLowerCase().trim()}`;

  // GET — read data
  if (req.method === 'GET') {
    try {
      const data = await kv.get(key);
      return res.status(200).json({ data: data || null });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to read data' });
    }
  }

  // POST — write data
  if (req.method === 'POST') {
    try {
      const { data } = req.body;
      if (!data) return res.status(400).json({ error: 'No data provided' });
      await kv.set(key, data);
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to save data' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
