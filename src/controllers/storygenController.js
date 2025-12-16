// StoryGenApp/backend/src/controllers/storygenController.js

const storygenService = require('../services/storygenService');
const { log } = require('../utils/logger');

/**
 * Generate or retrieve cached educational video
 * POST /api/storygen/generate
 */
exports.generateEducationalVideo = async (req, res) => {
  const {
    topic_id,
    chapter_id,
    subject_id,
    level,
    chapter,
    topic,
    subject,
  } = req.body;

  // Validate required fields - ALL fields are required
  if (!topic_id || !chapter_id || !subject_id || !level || !chapter || !topic || !subject) {
    console.log(`Request initiated ${topic_id}, ${chapter_id}, ${subject_id}, ${level}, ${subject}, ${topic}, ${chapter}`)
    return res.status(400).json({
      error: 'Missing required fields: topic_id, chapter_id, subject_id, level, chapter, topic, and subject are all required',
    });
  }

  // Validate that IDs and level are numbers
  if (!Number.isInteger(topic_id) || !Number.isInteger(chapter_id) || 
      !Number.isInteger(subject_id) || !Number.isInteger(level)) {
    return res.status(400).json({
      error: 'Invalid data types: topic_id, chapter_id, subject_id, and level must be integers',
    });
  }

  // Validate that level is within reasonable range (e.g., 1-12 for grades/classes)
  if (level < 1 || level > 12) {
    return res.status(400).json({
      error: 'Invalid level: must be between 1 and 12',
    });
  }

  try {
    log('storygen_request', {
      chapterId: chapter_id,
      topicId: topic_id,
      subjectId: subject_id,
      level,
    });

    // Check if video already exists in cache
    const cachedVideo = storygenService.getCachedVideo(
      chapter_id,
      topic_id,
      subject_id,
      level
    );

    if (cachedVideo) {
      log('storygen_cache_hit', {
        chapterId: chapter_id,
        topicId: topic_id,
        videoUrl: cachedVideo.videoUrl,
      });

      return res.json({
        video_url: cachedVideo.videoUrl,
        cached: true,
        metadata: {
          chapter_id,
          topic_id,
          subject_id,
          level,
          chapter: cachedVideo.chapter,
          topic: cachedVideo.topic,
          subject: cachedVideo.subject,
          created_at: cachedVideo.createdAt,
          access_count: cachedVideo.accessCount,
        },
      });
    }

    log('storygen_cache_miss', { chapterId: chapter_id, topicId: topic_id });

    // Generate new educational video
    const startTime = Date.now();

    const videoUrl = await storygenService.generateEducationalVideo({
      chapter,
      topic,
      subject,
      level,
    });

    const duration = Date.now() - startTime;
    log('storygen_video_generated', {
      videoUrl,
      duration,
      chapterId: chapter_id,
    });

    // Save to cache
    const cachedEntry = storygenService.saveCachedVideo({
      chapterId: chapter_id,
      topicId: topic_id,
      subjectId: subject_id,
      level,
      chapter: chapter,
      topic: topic,
      subject: subject,
      videoUrl,
    });

    log('storygen_saved_to_cache', { id: cachedEntry.id });

    return res.json({
      video_url: videoUrl,
      cached: false,
      metadata: {
        chapter_id,
        topic_id,
        subject_id,
        level,
        chapter,
        topic,
        subject,
        created_at: cachedEntry.createdAt,
        generation_time_ms: duration,
      },
    });

  } catch (error) {
    console.error('Error generating educational video:', error);
    log('storygen_error', {
      message: error.message,
      chapterId: chapter_id,
      topicId: topic_id,
    });

    res.status(500).json({
      error: 'Failed to generate educational video',
      message: error.message,
    });
  }
};

/**
 * Get all cached videos (admin endpoint)
 * GET /api/storygen/cache
 */
exports.getCachedVideos = async (req, res) => {
  try {
    const cachedVideos = storygenService.getAllCachedVideos();
    res.json({ videos: cachedVideos, count: cachedVideos.length });
  } catch (error) {
    console.error('Error fetching cached videos:', error);
    res.status(500).json({ error: 'Failed to fetch cached videos' });
  }
};

/**
 * Delete a cached video (admin endpoint)
 * DELETE /api/storygen/cache/:id
 */
exports.deleteCachedVideo = async (req, res) => {
  const { id } = req.params;

  try {
    storygenService.deleteCachedVideo(id);
    res.json({ success: true, message: 'Cached video deleted' });
  } catch (error) {
    console.error('Error deleting cached video:', error);
    res.status(500).json({ error: 'Failed to delete cached video' });
  }
};

/**
 * Clear all cached videos (admin endpoint)
 * DELETE /api/storygen/cache
 */
exports.clearCache = async (req, res) => {
  try {
    storygenService.clearCache();
    res.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
};