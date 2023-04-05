const redisClient = require('../utils/redis');
const dbClient = require('../utils/db');

export function getStatus(req, res) {
  const redis = redisClient.isAlive() || false;
  const db = dbClient.isAlive() || false;

  return res.json({ redis, db });
}

export async function getStats(req, res) {
  const users = await dbClient.nbUsers();
  const files = await dbClient.nbFiles();

  return res.json({ users, files });
}
