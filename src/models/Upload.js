const mongoose = require('mongoose');

const uploadSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  filepath: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  retry_count: { type: Number, default: 0 },
  failure_reason: { type: String },
  upload_timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Upload', uploadSchema);
