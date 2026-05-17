const { Worker } = require('bullmq');
const { connection } = require('../queues/image.queue');
const logger = require('../config/logger');
const imageAnalysisService = require('../services/imageAnalysis.service');
const Upload = require('../models/Upload');
const AnalysisResult = require('../models/AnalysisResult');
const path = require('path');

const worker = new Worker('image-processing', async (job) => {
  const { uploadId, filepath } = job.data;
  const startTime = Date.now();

  logger.info(`Worker starting job ${job.id} for upload ${uploadId}`);

  try {
    await Upload.findByIdAndUpdate(uploadId, { status: 'processing' });
    logger.info(`Running analysis on: ${filepath}`);

    const blur = await imageAnalysisService.detectBlur(filepath);
    const brightness = await imageAnalysisService.analyzeBrightness(filepath);
    const ocr = await imageAnalysisService.performOCR(filepath);
    const screenshot = await imageAnalysisService.detectScreenshot(filepath);

    const currentHash = await imageAnalysisService.getPerceptualHash(filepath);
    const duplicate_score = 0; 

    const results = {
      blur,
      brightness,
      plateValid: ocr.isValid,
      screenshot
    };

    const confidence_scores = imageAnalysisService.calculateConfidence(results);

    logger.info(`Analysis complete - Overall confidence: ${confidence_scores.overall}%`);

    await AnalysisResult.findOneAndUpdate(
      { upload_id: uploadId },
      {
        blur_score: blur.score,
        blur_variance: blur.rawVariance,
        blur_is_blurry: blur.isBlurry,
        brightness_score: brightness.score,
        brightness_raw: brightness.rawMean,
        brightness_too_dark: brightness.isTooDark,
        brightness_too_bright: brightness.isTooBright,
        duplicate_score,
        perceptual_hash: currentHash,
        ocr_text: ocr.text,
        plate_valid: ocr.isValid,
        ocr_confidence: ocr.confidence,
        screenshot_score: screenshot,
        confidence_scores
      },
      { upsert: true, new: true }
    );

    await Upload.findByIdAndUpdate(uploadId, { status: 'completed' });

    const duration = Date.now() - startTime;
    logger.info(`Worker completed job ${job.id} in ${duration}ms - Upload ${uploadId} marked as completed`);

  } catch (error) {
    logger.error(`Worker failed job ${job.id}: %o`, error);

    const upload = await Upload.findById(uploadId);
    if (upload) {
      const retryCount = job.attemptsMade + 1;
      await Upload.findByIdAndUpdate(uploadId, {
        status: retryCount >= 3 ? 'failed' : 'pending',
        retry_count: retryCount,
        failure_reason: error.message
      });

      logger.info(`Upload ${uploadId} retry count: ${retryCount}/3`);
    }

    throw error;
  }
}, {
  connection,
  concurrency: 2,
  removeOnComplete: { count: 100 }, 
  removeOnFail: { count: 50 } 
});

worker.on('completed', (job) => {
  logger.info(`✓ Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  logger.error(`✗ Job ${job.id} failed after ${job.attemptsMade} attempts: ${err.message}`);
});

worker.on('error', (err) => {
  logger.error(`Worker error: ${err.message}`);
});

module.exports = worker;