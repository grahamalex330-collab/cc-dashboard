import Redis from 'ioredis';

let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL);
  }
  return redis;
}

export default async function handler(req, res) {
  const code = req.query.code || req.body?.code;

  if (!code || typeof code !== 'string' || code.length < 2 || code.length > 50) {
    return res.status(400).json({ error: 'Invalid household code' });
  }

  const key = `cc:${code.toLowerCase().trim()}`;
  const client = getRedis();

  // GET — read data
  if (req.method === 'GET') {
    try {
      const raw = await client.get(key);
      const data = raw ? JSON.parse(raw) : null;
      return res.status(200).json({ data });
    } catch (error) {
      console.error('Redis read error:', error);
      return res.status(500).json({ error: 'Failed to read data' });
    }
  }

  // POST — write data
  if (req.method === 'POST') {
    try {
      const { data } = req.body;
      if (!data) return res.status(400).json({ error: 'No data provided' });
      await client.set(key, JSON.stringify(data));
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Redis write error:', error);
      return res.status(500).json({ error: 'Failed to save data' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
