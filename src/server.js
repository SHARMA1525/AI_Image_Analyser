require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const logger = require('./config/logger');

require('./workers/image.worker');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vehicle_pipeline';

mongoose.connect(MONGODB_URI)
  .then(() => {
    logger.info('Connected to MongoDB');
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    logger.error('MongoDB connection error: %o', err);
    process.exit(1);
  });

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection! Shutting down...');
  logger.error(err);
  process.exit(1);
});
