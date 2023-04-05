const { createClient } = require('redis');
const { promisify } = require('util');

class RedisClient {
  constructor() {
    this.client = createClient();
    this.getPromise = promisify(this.client.get).bind(this.client);
    this.setPromise = promisify(this.client.set).bind(this.client);
    this.delPromise = promisify(this.client.del).bind(this.client);
    this.client.on('error', (err) => {
      console.log(err);
    });
  }

  isAlive() {
    return this.client.connected;
  }

  async get(key) {
    const value = await this.getPromise(key);
    return value;
  }

  async set(key, value, duration) {
    await this.setPromise(key, value, 'EX', duration);
  }

  async del(key) {
    await this.delPromise(key);
  }
}

const redisClient = new RedisClient();
module.exports = redisClient;
