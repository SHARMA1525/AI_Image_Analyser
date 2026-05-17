const Upload = require('../models/Upload');
const AnalysisResult = require('../models/AnalysisResult');
const { imageQueue } = require('../queues/image.queue');
const logger = require('../config/logger');
const path = require('path');

exports.uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image uploaded'
      });
    }

    const { filename, path: filepath } = req.file;

    const upload = new Upload({
      filename,
      filepath: path.resolve(filepath),
      status: 'pending'
    });
    await upload.save();

    await imageQueue.add('process-image', {
      uploadId: upload._id,
      filepath: upload.filepath
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    logger.info(`Upload received: ${upload._id}, File: ${filename}`);

    res.status(202).json({
      success: true,
      message: 'Upload successful, processing started',
      processing_id: upload._id,
      filename: filename
    });
  } catch (error) {
    logger.error('Upload error: %o', error);
    next(error);
  }
};

exports.getStatus = async (req, res, next) => {
  try {
    const upload = await Upload.findById(req.params.id);

    if (!upload) {
      return res.status(404).json({
        success: false,
        error: 'Processing ID not found'
      });
    }

    res.json({
      success: true,
      id: upload._id,
      status: upload.status,
      filename: upload.filename,
      retry_count: upload.retry_count || 0,
      failure_reason: upload.failure_reason || null,
      upload_timestamp: upload.upload_timestamp,
      updated_at: upload.updatedAt
    });
  } catch (error) {
    logger.error('Get status error: %o', error);
    next(error);
  }
};

exports.getResults = async (req, res, next) => {
  try {
    const upload = await Upload.findById(req.params.id);

    if (!upload) {
      return res.status(404).json({
        success: false,
        error: 'Processing ID not found'
      });
    }

    if (upload.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Analysis not complete',
        status: upload.status,
        message: upload.status === 'failed'
          ? `Processing failed: ${upload.failure_reason}`
          : `Current status: ${upload.status}`
      });
    }

    const results = await AnalysisResult.findOne({ upload_id: upload._id });

    if (!results) {
      return res.status(404).json({
        success: false,
        error: 'Analysis results not found'
      });
    }

    res.json({
      success: true,
      upload: {
        id: upload._id,
        filename: upload.filename,
        status: upload.status,
        upload_timestamp: upload.upload_timestamp
      },
      analysis: {
        blur: {
          score: results.blur_score,
          variance: results.blur_variance,
          isBlurry: results.blur_is_blurry
        },
        brightness: {
          score: results.brightness_score,
          rawMean: results.brightness_raw,
          isTooDark: results.brightness_too_dark,
          isTooBright: results.brightness_too_bright
        },
        ocr: {
          text: results.ocr_text,
          valid: results.plate_valid,
          confidence: results.ocr_confidence
        },
        screenshot: {
          score: results.screenshot_score,
          isLikelyScreenshot: results.screenshot_score > 50
        },
        duplicate: {
          score: results.duplicate_score,
          hash: results.perceptual_hash
        }
      },
      confidence_scores: {
        overall: results.confidence_scores?.overall || 0,
        blur: results.confidence_scores?.blur || 0,
        brightness: results.confidence_scores?.brightness || 0,
        ocr: results.confidence_scores?.ocr || 0,
        screenshot: results.confidence_scores?.screenshot || 0
      },
      summary: {
        quality: results.confidence_scores?.overall >= 70 ? 'Good' :
          results.confidence_scores?.overall >= 50 ? 'Fair' : 'Poor',
        issues: getIssuesSummary(results),
        recommendations: getRecommendations(results)
      },
      timestamp: results.createdAt
    });
  } catch (error) {
    logger.error('Get results error: %o', error);
    next(error);
  }
};

function getIssuesSummary(results) {
  const issues = [];

  if (results.blur_is_blurry) {
    issues.push({
      type: 'blur',
      severity: 'high',
      message: 'Image is blurry or out of focus',
      detail: `Sharpness score: ${results.blur_score}/100 (higher = sharper)`
    });
  }

  if (results.brightness_too_dark) {
    issues.push({
      type: 'brightness',
      severity: 'medium',
      message: 'Image is too dark',
      detail: `Brightness: ${results.brightness_score}/100`
    });
  }

  if (results.brightness_too_bright) {
    issues.push({
      type: 'brightness',
      severity: 'medium',
      message: 'Image is too bright (overexposed)',
      detail: `Brightness: ${results.brightness_score}/100`
    });
  }

  if (!results.plate_valid) {
    const detectedText = results.ocr_text && results.ocr_text !== 'NOT_DETECTED'
      ? `Detected: "${results.ocr_text}" (no valid plate pattern found)`
      : 'No plate text found in image';
    issues.push({
      type: 'ocr',
      severity: 'high',
      message: 'Number plate not detected or does not match Indian plate format',
      detail: detectedText
    });
  }

  if (results.screenshot_score > 60) {
    issues.push({
      type: 'screenshot',
      severity: 'high',
      message: 'Image appears to be a screenshot or photo-of-photo',
      detail: `Screenshot likelihood: ${results.screenshot_score}%`
    });
  }

  return issues;
}

function getRecommendations(results) {
  const recommendations = [];

  if (results.blur_is_blurry) {
    recommendations.push('Ensure camera is focused and stable when capturing');
  }

  if (results.brightness_too_dark) {
    recommendations.push('Capture image in better lighting conditions');
  }

  if (results.brightness_too_bright) {
    recommendations.push('Avoid direct sunlight or flash reflection');
  }

  if (!results.plate_valid) {
    recommendations.push('Ensure number plate is clearly visible and in frame');
    recommendations.push('Capture from front or rear angle, not side view');
  }

  if (results.screenshot_score > 60) {
    recommendations.push('Submit original photos, not screenshots');
  }

  if (recommendations.length === 0) {
    recommendations.push('Image quality is acceptable');
  }

  return recommendations;
}

exports.getAllUploads = async (req, res, next) => {
  try {
    const { status, limit = 20, page = 1 } = req.query;

    const query = status ? { status } : {};
    const skip = (page - 1) * limit;

    const uploads = await Upload.find(query)
      .sort({ upload_timestamp: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Upload.countDocuments(query);

    res.json({
      success: true,
      data: uploads,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Get all uploads error: %o', error);
    next(error);
  }
};

exports.deleteUpload = async (req, res, next) => {
  try {
    const upload = await Upload.findById(req.params.id);

    if (!upload) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found'
      });
    }

    const fs = require('fs');
    if (fs.existsSync(upload.filepath)) {
      fs.unlinkSync(upload.filepath);
      logger.info(`Deleted file: ${upload.filepath}`);
    }

    await Upload.findByIdAndDelete(req.params.id);
    await AnalysisResult.deleteOne({ upload_id: req.params.id });

    res.json({
      success: true,
      message: 'Upload and analysis results deleted successfully'
    });
  } catch (error) {
    logger.error('Delete upload error: %o', error);
    next(error);
  }
};