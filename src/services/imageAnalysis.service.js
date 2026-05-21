const sharp = require('sharp');
sharp.cache(false);
const Tesseract = require('tesseract.js');
const imghash = require('imghash');
const path = require('path');
const fs = require('fs');
const logger = require('../config/logger');

class ImageAnalysisService {
  async detectBlur(imagePath) {
    try {
      const { data, info } = await sharp(imagePath)
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height } = info;
      const pixels = new Float32Array(data);
      const laplacianValues = [];
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const lap =
            pixels[idx - width] +  
            pixels[idx + width] +  
            pixels[idx - 1] +      
            pixels[idx + 1] -      
            4 * pixels[idx];       
          laplacianValues.push(lap);
        }
      }

      const n = laplacianValues.length;
      const mean = laplacianValues.reduce((s, v) => s + v, 0) / n;
      const variance = laplacianValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n;
      let score;
      if (variance < 100) {
        score = (variance / 100) * 30;
      } else if (variance < 500) {
        score = 30 + ((variance - 100) / 400) * 50;
      } else {
        score = 80 + Math.min(20, (variance - 500) / 100);
      }

      const isBlurry = variance < 200;
      logger.info(`[BLUR] Variance: ${variance.toFixed(2)}, Score: ${score.toFixed(2)}, IsBlurry: ${isBlurry}`);

      return { score: Math.round(score), rawVariance: variance.toFixed(2), isBlurry };
    } catch (error) {
      logger.error('Blur detection failed: %o', error);
      return { score: 0, rawVariance: '0', isBlurry: true };
    }
  }

  async analyzeBrightness(imagePath) {
    try {
      const stats = await sharp(imagePath).greyscale().stats();
      const mean = stats.channels[0].mean;
      const normalizedBrightness = (mean / 255) * 100;
      const isTooDark = normalizedBrightness < 30;
      const isTooBright = normalizedBrightness > 85;

      logger.info(`[BRIGHTNESS] Raw mean: ${mean.toFixed(2)}, Normalized: ${normalizedBrightness.toFixed(2)}`);

      return { score: Math.round(normalizedBrightness), rawMean: mean.toFixed(2), isTooDark, isTooBright };
    } catch (error) {
      logger.error('Brightness analysis failed: %o', error);
      return { score: 0, rawMean: '0', isTooDark: true, isTooBright: false };
    }
  }

  async getPerceptualHash(imagePath) {
    try {
      const hash = await imghash.hash(imagePath, 16, 'hex');
      logger.info(`[HASH] ${hash}`);
      return hash;
    } catch (error) {
      logger.error('Hash generation failed: %o', error);
      return null;
    }
  }

  _normalizeCandidate(raw) {
    const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length < 8 || s.length > 11) return s;

    const toDigit = { O: '0', I: '1', S: '5', B: '8', Z: '2', G: '6', Q: '0' };
    const toLetter = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G' };

    const c = s.split('');
    const last4Start = c.length - 4;

    for (let i = 0; i < c.length; i++) {
      const isLastFour = i >= last4Start;
      const isFirstTwo = i < 2;
      if (isFirstTwo) {
        if (toLetter[c[i]]) c[i] = toLetter[c[i]];
      } else if (isLastFour) {
        if (toDigit[c[i]]) c[i] = toDigit[c[i]];
      } else {
        const isAlpha = /[A-Z]/.test(c[i]);
        if (!isAlpha && toLetter[c[i]]) c[i] = toLetter[c[i]];
      }
    }

    return c.join('');
  }

  _extractPlateFromText(rawText) {
    const cleaned = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const withDigitFix = cleaned
      .replace(/O(?=[0-9A-Z]{6,8}$)/g, '0') 
      .replace(/(?<=[A-Z]{2})O/g, '0')      
      .replace(/(?<=[A-Z]{2}[0-9]{1,2}[A-Z]{0,3})I(?=[0-9])/g, '1'); 
    const plateRegex = /[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}/g;

    const candidates = [
      ...(cleaned.match(plateRegex) || []),
      ...(withDigitFix.match(plateRegex) || []),
    ];

    if (candidates.length === 0) return null;
    const normalized = [...new Set(candidates.map(c => this._normalizeCandidate(c)))];
    normalized.sort((a, b) => b.length - a.length);
    return normalized[0];
  }

  async _generateOCRVariants(imagePath) {
    const ext = path.extname(imagePath);
    const basePath = imagePath.replace(ext, '');
    const variants = [];

    const resized = sharp(imagePath).resize(1800, null, {
      fit: 'inside', withoutEnlargement: false, kernel: sharp.kernel.lanczos3
    });

    const configs = [
      { name: 'v1_norm', fn: () => resized.clone().greyscale().normalize().sharpen({ sigma: 1.5 }) },
      { name: 'v2_bin', fn: () => resized.clone().greyscale().normalize().linear(2.5, -100).threshold(130) },
      { name: 'v3_inv', fn: () => resized.clone().greyscale().negate().normalize().threshold(130) },
      { name: 'v4_contrast', fn: () => resized.clone().greyscale().linear(1.6, -(128 * 0.6)).normalize() },
    ];

    for (const cfg of configs) {
      const p = `${basePath}_ocr_${cfg.name}.png`;
      try {
        await cfg.fn().toFile(p);
        variants.push(p);
      } catch (err) {
        logger.warn(`[OCR] Variant ${cfg.name} failed: ${err.message}`);
      }
    }

    return variants;
  }

  async performOCR(imagePath) {
    const tempFiles = [];
    let worker = null;

    try {
      const variants = await this._generateOCRVariants(imagePath);
      tempFiles.push(...variants);
      const psmModes = [7, 8]; // PSM 7 (single line) & 8 (single word) are the most accurate and fastest for license plates

      let bestPlate = null;
      let bestConfidence = 0;

      // Initialize Tesseract worker once and reuse it to save CPU and memory
      worker = await Tesseract.createWorker('eng');

      for (const variantPath of variants) {
        for (const psm of psmModes) {
          try {
            const { data: { text, confidence } } = await worker.recognize(
              variantPath,
              {
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                tessedit_pageseg_mode: psm,
              }
            );

            const raw = text.trim();
            const plate = this._extractPlateFromText(raw);

            logger.info(
              `[OCR] ${path.basename(variantPath)} PSM${psm} → ` +
              `raw="${raw.replace(/\n/g, ' ').slice(0, 40)}", ` +
              `plate=${plate}, conf=${confidence.toFixed(1)}%`
            );

            if (plate && confidence > bestConfidence) {
              bestPlate = plate;
              bestConfidence = confidence;
            }
          } catch (err) {
            logger.warn(`[OCR] ${path.basename(variantPath)} PSM${psm}: ${err.message}`);
          }
        }

        // Break early if we find a valid plate with high confidence
        if (bestPlate && bestConfidence >= 80) {
          logger.info(`[OCR] High confidence plate found (${bestConfidence.toFixed(1)}%). Breaking early.`);
          break;
        }
      }

      const isValid = bestPlate !== null;
      logger.info(`[OCR] ✓ Final: plate="${bestPlate}", valid=${isValid}, conf=${bestConfidence.toFixed(1)}%`);

      return {
        text: bestPlate || 'NOT_DETECTED',
        isValid,
        confidence: Math.round(bestConfidence)
      };

    } catch (error) {
      logger.error('OCR failed: %o', error);
      return { text: 'NOT_DETECTED', isValid: false, confidence: 0 };
    } finally {
      // Clean up worker
      if (worker) {
        try { await worker.terminate(); } catch (_) {}
      }
      // Clean up temp files
      for (const f of tempFiles) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
      }
    }
  }
  async detectScreenshot(imagePath) {
    try {
      const metadata = await sharp(imagePath).metadata();
      const { width, height, format, exif } = metadata;

      let score = 0;
      const reasons = [];

      const hasMinimalExif = !exif || Object.keys(exif).length < 5;
      if (hasMinimalExif) { score += 30; reasons.push('Minimal EXIF'); }

      const ratio = width / height;
      const screenRatios = [
        { r: 16 / 9, n: '16:9' }, { r: 9 / 16, n: '9:16' },
        { r: 19.5 / 9, n: '19.5:9' }, { r: 4 / 3, n: '4:3' }
      ];
      const matchRatio = screenRatios.find(({ r }) => Math.abs(ratio - r) < 0.05);
      if (matchRatio) { score += 25; reasons.push(`Ratio: ${matchRatio.n}`); }

      const screenRes = [
        [1920, 1080], [1080, 1920], [2560, 1440], [1440, 2560],
        [1366, 768], [768, 1366], [375, 667], [414, 896]
      ];
      if (screenRes.some(([w, h]) => (width === w && height === h) || (width === h && height === w))) {
        score += 25; reasons.push(`Screen res: ${width}x${height}`);
      }

      if (format === 'png') { score += 20; reasons.push('PNG format'); }

      score = Math.min(100, score);
      logger.info(`[SCREENSHOT] Score: ${score}, ${reasons.join(', ')}`);
      return score;

    } catch (error) {
      logger.error('Screenshot detection failed: %o', error);
      return 0;
    }
  }
  calculateConfidence(results) {
    const { blur, brightness, plateValid, screenshot } = results;

    const blurScore = blur?.score ?? 0;
    const brightScore = brightness?.score ?? 0;

    const blurConf = blurScore;

    let brightConf;
    if (brightScore >= 35 && brightScore <= 80) {
      brightConf = 100;
    } else if (brightScore < 35) {
      brightConf = Math.max(0, (brightScore / 35) * 100);
    } else {
      brightConf = Math.max(0, ((100 - brightScore) / 20) * 100);
    }

    const ocrConf = plateValid ? 90 : 10;
    const screenConf = Math.max(0, 100 - screenshot);

    const overall =
      blurConf * 0.30 +
      brightConf * 0.20 +
      ocrConf * 0.40 +
      screenConf * 0.10;

    const scores = {
      overall: Math.round(overall),
      blur: Math.round(blurConf),
      brightness: Math.round(brightConf),
      ocr: Math.round(ocrConf),
      screenshot: Math.round(screenConf)
    };

    logger.info(`[CONFIDENCE] Overall: ${scores.overall}%, Blur: ${scores.blur}%, Bright: ${scores.brightness}%, OCR: ${scores.ocr}%, Screen: ${scores.screenshot}%`);
    return scores;
  }
}

module.exports = new ImageAnalysisService();