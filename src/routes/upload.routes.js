const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const uploadController = require('../controllers/upload.controller');
const { validateId } = require('../middlewares/validation.middleware');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Only images (jpeg, jpg, png, webp) are allowed'));
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

router.post('/upload', upload.single('vehicle_image'), uploadController.uploadImage);
router.get('/status/:id', uploadController.getStatus);
router.get('/results/:id', uploadController.getResults);
router.get('/uploads', uploadController.getAllUploads);
router.delete('/uploads/:id', uploadController.deleteUpload);

module.exports = router;
