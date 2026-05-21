const { Queue } = require('bullmq');
const logger = require('../config/logger');

const connection = process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
};

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
