const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const path = require('path');
const uploadRoutes = require('./routes/upload.routes');
const { errorHandler } = require('./middlewares/error.middleware');
const logger = require('./config/logger');

const app = express();

app.use(helmet());
app.use(cors());

app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api', uploadRoutes);

app.use((req, res, next) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use(errorHandler);

module.exports = app;
