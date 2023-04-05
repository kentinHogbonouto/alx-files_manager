const sha1 = require('sha1');
const { ObjectID } = require('mongodb');
const dbClient = require('../utils/db');
const redisClient = require('../utils/redis');

class UsersController {
  static async postNew(req, res) {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    // check if user already exists
    const users = dbClient.db.collection('users');
    let user = await users.findOne({ email });
    if (user) {
      return res.status(400).json({ error: 'Already exist' });
    }

    // create user
    const hashedPassword = sha1(password);
    user = await users.insertOne({
      email,
      password: hashedPassword,
    });

    return res.status(201).json({ id: user.insertedId, email });
  }

  static async getMe(req, res) {
    const token = req.headers['x-token'];
    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const id = new ObjectID(userId);
    const user = await dbClient.db.collection('users').findOne({ _id: id });
    return res.json({ email: user.email, id: userId });
  }
}

module.exports = UsersController;
