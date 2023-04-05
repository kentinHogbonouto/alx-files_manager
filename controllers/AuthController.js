const sha1 = require('sha1');
const uuidv4 = require('uuid').v4;
const dbClient = require('../utils/db');
const redisClient = require('../utils/redis');

class AuthController {
  static async getConnect(req, res) {
    const header = req.headers.authorization;
    if (!header) { return res.status(401).json({ error: 'Unauthorized' }); }
    const data = header.split(' ')[1];
    const [email, password] = Buffer.from(data, 'base64').toString('ascii').split(':');
    const users = dbClient.db.collection('users');
    const user = await users.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (sha1(password) !== user.password) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = uuidv4();
    const key = `auth_${token}`;
    await redisClient.set(key, user._id.toString(), 60 * 60 * 24);
    return res.status(200).json({ token });
  }

  static async getDisconnect(req, res) {
    const token = req.headers['x-token'];
    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await redisClient.del(`auth_${token}`);
    return res.status(204).json({});
  }
}

module.exports = AuthController;
