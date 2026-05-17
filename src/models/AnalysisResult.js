const mongoose = require('mongoose');

const analysisResultSchema = new mongoose.Schema({
  upload_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Upload',
    required: true,
    unique: true
  },

  blur_score: { type: Number, default: 0 }, 
  blur_variance: { type: String, default: '0' }, 
  blur_is_blurry: { type: Boolean, default: false },

  brightness_score: { type: Number, default: 0 },
  brightness_raw: { type: String, default: '0' },
  brightness_too_dark: { type: Boolean, default: false },
  brightness_too_bright: { type: Boolean, default: false },

  duplicate_score: { type: Number, default: 0 },
  perceptual_hash: { type: String, default: null },

  ocr_text: { type: String, default: '' },
  plate_valid: { type: Boolean, default: false },
  ocr_confidence: { type: Number, default: 0 },

  screenshot_score: { type: Number, default: 0 },

  confidence_scores: {
    overall: { type: Number, default: 0 },
    blur: { type: Number, default: 0 },
    brightness: { type: Number, default: 0 },
    ocr: { type: Number, default: 0 },
    screenshot: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AnalysisResult', analysisResultSchema);