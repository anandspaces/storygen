// StoryGenApp/backend/src/routes/storygenRoutes.js

const express = require('express');
const {
  generateEducationalVideo,
  checkVideoCache,
  getCachedVideos,
  deleteCachedVideo,
  clearCache,
} = require('../controllers/storygenController');

const router = express.Router();

// Check cache status without generating (NEW)
router.post('/check', checkVideoCache);

// Main endpoint: Generate or retrieve cached educational video
router.post('/generate', generateEducationalVideo);

// Admin endpoints for cache management
router.get('/cache', getCachedVideos);
router.delete('/cache/:id', deleteCachedVideo);
router.delete('/cache', clearCache);

module.exports = router;