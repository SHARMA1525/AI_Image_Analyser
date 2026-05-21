const { Queue } = require('bullmq');
const logger = require('../config/logger');

const url = require('url');

let connection;

if (process.env.REDIS_URL) {
  try {
    const parsed = url.parse(process.env.REDIS_URL);
    const auth = parsed.auth ? parsed.auth.split(':') : [];
    connection = {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 6379,
      username: auth[0] || undefined,
      password: auth[1] || undefined,
      tls: parsed.protocol === 'rediss:' ? { rejectUnauthorized: false } : undefined,
      maxRetriesPerRequest: null
    };
  } catch (err) {
    logger.error('Failed to parse REDIS_URL, falling back to defaults: %o', err);
    connection = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: null
    };
  }
} else {
  connection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null
  };
}

const imageQueue = new Queue('image-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  }
});

imageQueue.on('error', (err) => {
  logger.error('Queue Error: %o', err);
});

module.exports = { imageQueue, connection };
