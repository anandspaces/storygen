// StoryGenApp/backend/src/services/storygenService.js

const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { log } = require('../utils/logger');
const { fetch } = require('undici');
const { GoogleAuth } = require('google-auth-library');

const dataDir = path.join(__dirname, '../../data');
const videoDir = path.join(dataDir, 'videos');
const dbPath = path.join(dataDir, 'gallery.db');

// Ensure directories exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(videoDir)) {
  fs.mkdirSync(videoDir, { recursive: true });
}

const db = new Database(dbPath);

// Create table for educational content video cache
db.exec(`
  CREATE TABLE IF NOT EXISTS storygen_cache (
    id TEXT PRIMARY KEY,
    chapter_id INTEGER NOT NULL,
    topic_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    chapter TEXT,
    topic TEXT,
    subject TEXT,
    video_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_accessed TEXT NOT NULL,
    access_count INTEGER DEFAULT 1
  );
`);

// Create index for faster lookups
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_storygen_lookup 
  ON storygen_cache(chapter_id, topic_id, subject_id, level);
`);

// Educational video style
const EDUCATIONAL_STYLE = "Educational style, clear and engaging visuals, professional lighting, warm colors, 16:9 composition, informative and approachable, suitable for students";

/**
 * Generate a unique cache key from the identifiers
 */
const generateCacheKey = (chapterId, topicId, subjectId, level) => {
  const combined = `${chapterId}-${topicId}-${subjectId}-${level}`;
  return crypto.createHash('md5').update(combined).digest('hex');
};

/**
 * Check if a video already exists in cache
 */
exports.getCachedVideo = (chapterId, topicId, subjectId, level) => {
  const row = db.prepare(`
    SELECT * FROM storygen_cache 
    WHERE chapter_id = ? AND topic_id = ? AND subject_id = ? AND level = ?
  `).get(chapterId, topicId, subjectId, level);

  if (row) {
    // Update last accessed time and increment access count
    db.prepare(`
      UPDATE storygen_cache 
      SET last_accessed = ?, access_count = access_count + 1 
      WHERE id = ?
    `).run(new Date().toISOString(), row.id);

    return {
      id: row.id,
      chapterId: row.chapter_id,
      topicId: row.topic_id,
      subjectId: row.subject_id,
      level: row.level,
      chapter: row.chapter,
      topic: row.topic,
      subject: row.subject,
      videoUrl: row.video_url,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count + 1,
    };
  }

  return null;
};

/**
 * Save a newly generated video to cache
 */
exports.saveCachedVideo = (params) => {
  const {
    chapterId,
    topicId,
    subjectId,
    level,
    chapter,
    topic,
    subject,
    videoUrl,
  } = params;

  const id = generateCacheKey(chapterId, topicId, subjectId, level);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO storygen_cache (
      id, chapter_id, topic_id, subject_id, level, 
      chapter, topic, subject, video_url, 
      created_at, last_accessed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    chapterId,
    topicId,
    subjectId,
    level,
    chapter,
    topic,
    subject,
    videoUrl,
    now,
    now
  );

  return {
    id,
    chapterId,
    topicId,
    subjectId,
    level,
    chapter,
    topic,
    subject,
    videoUrl,
    createdAt: now,
    lastAccessed: now,
    accessCount: 1,
  };
};

/**
 * Get all cached videos (for admin/debugging)
 */
exports.getAllCachedVideos = () => {
  const rows = db.prepare(`
    SELECT * FROM storygen_cache 
    ORDER BY datetime(created_at) DESC 
    LIMIT 100
  `).all();

  return rows.map(row => ({
    id: row.id,
    chapterId: row.chapter_id,
    topicId: row.topic_id,
    subjectId: row.subject_id,
    level: row.level,
    chapter: row.chapter,
    topic: row.topic,
    subject: row.subject,
    videoUrl: row.video_url,
    createdAt: row.created_at,
    lastAccessed: row.last_accessed,
    accessCount: row.access_count,
  }));
};

/**
 * Delete a cached video entry
 */
exports.deleteCachedVideo = (id) => {
  db.prepare('DELETE FROM storygen_cache WHERE id = ?').run(id);
};

/**
 * Clear all cached videos
 */
exports.clearCache = () => {
  db.prepare('DELETE FROM storygen_cache').run();
};

/**
 * Generate educational storyboard using Gemini
 */
const generateEducationalStoryboard = async (chapter, topic, subject, level) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const geminiTextModel = process.env.GEMINI_TEXT_MODEL;

  if (!apiKey || apiKey.trim() === '' || apiKey.startsWith('your_')) {
    throw new Error("No valid GEMINI_API_KEY found for educational video generation.");
  }

  const shotCount = 3; // Fixed 3 shots for educational content
  
  log('educational_storyboard_start', { 
    model: geminiTextModel, 
    topic, 
    chapter, 
    subject, 
    level 
  });

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: geminiTextModel });

  const educationalPrompt = `
Role: You are a professional educational content creator and storyboard artist.

Task: Create a ${shotCount}-shot educational video storyboard explaining "${topic}" from the chapter "${chapter}" in ${subject} for Class ${level} students.

Requirements:
1. Educational Focus: Each shot must clearly explain a concept or demonstrate a principle related to the topic.
2. Progressive Learning: Shots should build upon each other, starting from basic concepts and moving to more complex ideas.
3. Visual Clarity: Use clear, simple visuals that enhance understanding.
4. Student-Friendly: Language and visuals appropriate for Class ${level} students (ages ${level + 5}-${level + 6}).
5. Engagement: Include real-world examples, analogies, or applications where relevant.

SAFETY GUIDELINES:
- All content must be educational and age-appropriate for Class ${level} students
- No violent, sexual, or inappropriate content
- Use fictional characters or generic descriptions (e.g., "a student", "the teacher")
- No real person names or identifiable individuals
- Focus on clear, positive, educational messaging

Output format: ONLY a raw JSON array (no markdown, no code fences, no extra text).
Each element must be a JSON object with:

- shot: integer (1..${shotCount})
- prompt: Detailed ENGLISH visual description for the shot. Include camera angle, lighting, what's shown, and any key visual elements. Must be educational and appropriate for Class ${level} students. Focus on clarity and learning.
- duration: integer, MUST be exactly 4, 6, or 8 (seconds)
- description: A concise English summary (1 sentence) of what's happening on screen
- shotStory: 2-3 sentences in English explaining this shot's educational purpose and how it connects to the previous shot. Use connecting words like "first", "next", "then", "subsequently", "finally" to show progression.
- heroSubject: ONLY in shot 1. A detailed description of the main visual subject (could be a character, object, diagram, etc.) that will appear consistently. Example: "A clean whiteboard with colorful markers, or a simple animated diagram showing the process step by step"

Visual Style: ${EDUCATIONAL_STYLE}

Remember: Focus on educational clarity, step-by-step explanation, and visual learning aids suitable for Class ${level} students.
`;

  try {
    const result = await model.generateContent(educationalPrompt);
    const response = await result.response;
    let text = response.text();

    // Clean up potential markdown formatting
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    const storyboard = JSON.parse(text);
    
    log('educational_storyboard_success', { shots: storyboard.length });
    return storyboard;

  } catch (error) {
    console.error("Error generating educational storyboard:", error);
    log('educational_storyboard_error', { message: error.message });
    throw error;
  }
};

/**
 * Generate images for educational storyboard using Gemini
 */
const generateEducationalImages = async (storyboard) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const imageModel = process.env.GEMINI_IMAGE_MODEL;

  if (!apiKey || apiKey.trim() === "" || apiKey.startsWith("your_")) {
    throw new Error("No valid GEMINI_API_KEY found for image generation.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: imageModel });

  const storyboardWithImages = [];
  let referenceImageBase64 = null;
  let heroSubject = storyboard[0]?.heroSubject || '';

  for (let i = 0; i < storyboard.length; i++) {
    const shot = storyboard[i];
    
    const heroInstruction = heroSubject
      ? `Main subject consistency: ${heroSubject}`
      : "";

    const imagePrompt = `
Role: Educational visual artist
Style: ${EDUCATIONAL_STYLE}
${heroInstruction}
Shot description: ${shot.prompt}
Requirements: Educational, clear, professional, 16:9 format, no text overlays, appropriate for students
`;

    const contentParts = [];
    if (referenceImageBase64 && i > 0) {
      contentParts.push({
        inlineData: {
          mimeType: "image/png",
          data: referenceImageBase64,
        },
      });
      contentParts.push({ 
        text: "Reference image above for visual consistency. Generate new educational image:\n\n" + imagePrompt 
      });
    } else {
      contentParts.push({ text: imagePrompt });
    }

    try {
      const result = await model.generateContent({
        contents: [{
          role: "user",
          parts: contentParts,
        }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: "16:9"
          }
        },
      });

      const candidates = result?.response?.candidates || [];
      let imageUrl = null;

      for (const candidate of candidates) {
        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType || "image/png";
            const base64 = part.inlineData.data;
            imageUrl = `data:${mimeType};base64,${base64}`;
            
            if (i === 0) {
              referenceImageBase64 = base64;
            }
            break;
          }
        }
        if (imageUrl) break;
      }

      if (!imageUrl) {
        console.warn(`No image generated for shot ${i + 1}, using placeholder`);
        imageUrl = `https://placehold.co/800x450/333/FFF?text=Shot+${i + 1}`;
      }

      storyboardWithImages.push({ ...shot, imageUrl });
      log('educational_image_generated', { shot: i + 1 });

    } catch (error) {
      console.error(`Error generating image for shot ${i + 1}:`, error);
      const fallbackUrl = `https://placehold.co/800x450/333/FFF?text=Shot+${i + 1}`;
      storyboardWithImages.push({ ...shot, imageUrl: fallbackUrl });
    }
  }

  return storyboardWithImages;
};

/**
 * Read image bytes from URL or base64
 */
const readImageBytes = async (imageUrl) => {
  if (!imageUrl) return null;

  const DATA_URL_REGEX = /^data:(.+?);base64,(.+)$/;
  const dataMatch = DATA_URL_REGEX.exec(imageUrl);

  if (dataMatch) {
    return { 
      bytesBase64Encoded: dataMatch[2], 
      mimeType: dataMatch[1] || 'image/png' 
    };
  }

  if (imageUrl.startsWith('http')) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { 
      bytesBase64Encoded: buffer.toString('base64'), 
      mimeType: res.headers.get('content-type') || 'image/png' 
    };
  }

  throw new Error(`Unsupported image format: ${imageUrl}`);
};

/**
 * Generate video using Vertex AI
 */
const generateVideoWithVertex = async (storyboardWithImages) => {
  const projectId = process.env.VERTEX_PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const modelId = process.env.VERTEX_VEO_MODEL_ID || 'veo-3.1-generate-preview';

  if (!projectId) {
    throw new Error('VERTEX_PROJECT_ID is required for video generation');
  }

  log('vertex_video_generation_start', { shots: storyboardWithImages.length });

  // Generate transition videos between shots
  const videoClips = [];

  for (let i = 0; i < storyboardWithImages.length - 1; i++) {
    const shotA = storyboardWithImages[i];
    const shotB = storyboardWithImages[i + 1];

    const transitionPrompt = `Educational transition from "${shotA.description}" to "${shotB.description}". ${shotB.prompt}`;
    const duration = parseInt(shotB.duration, 10) || 6;

    const firstFrame = await readImageBytes(shotA.imageUrl);
    const lastFrame = await readImageBytes(shotB.imageUrl);

    // Start video job
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predictLongRunning`;

    const auth = new GoogleAuth({ 
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../../key.json'),
      scopes: ['https://www.googleapis.com/auth/cloud-platform'] 
    });
    
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const body = {
      instances: [{
        prompt: transitionPrompt,
        image: firstFrame,
        lastFrame: lastFrame,
      }],
      parameters: {
        aspectRatio: "16:9",
        durationSeconds: duration,
        resolution: "1080p",
        personGeneration: "allow_all",
        enhancePrompt: true,
        generateAudio: true
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token?.token || token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Video generation failed: ${res.status} ${text}`);
    }

    const json = await res.json();
    const operationName = json.name;

    log('vertex_clip_started', { operation: operationName, shot: i + 1 });

    // Poll for completion
    const pollUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:fetchPredictOperation`;
    
    let completed = false;
    let attempts = 0;
    const maxAttempts = 60;

    while (!completed && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 10000)); // Wait 10 seconds
      
      const pollRes = await fetch(pollUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token?.token || token}`
        },
        body: JSON.stringify({ operationName })
      });

      if (pollRes.ok) {
        const pollJson = await pollRes.json();
        
        // Check for errors in response
        if (pollJson.error) {
          throw new Error(`Video generation failed for clip ${i + 1}: ${pollJson.error.message || JSON.stringify(pollJson.error)}`);
        }
        
        if (pollJson.done) {
          completed = true;
          
          // Log the full response structure for debugging
          log('vertex_poll_response', { 
            shot: i + 1,
            hasResponse: !!pollJson.response,
            responseKeys: pollJson.response ? Object.keys(pollJson.response) : []
          });
          
          let videoBase64 = null;
          
          // Try multiple response structures
          // Structure 1: generateVideoResponse.generatedSamples
          const samples = pollJson?.response?.generateVideoResponse?.generatedSamples;
          if (samples && samples.length > 0 && samples[0].video?.bytesBase64Encoded) {
            videoBase64 = samples[0].video.bytesBase64Encoded;
          }
          
          // Structure 2: predictions array
          if (!videoBase64 && pollJson?.response?.predictions) {
            const predictions = pollJson.response.predictions;
            if (predictions.length > 0 && predictions[0].bytesBase64Encoded) {
              videoBase64 = predictions[0].bytesBase64Encoded;
            }
          }
          
          // Structure 3: Direct video in response
          if (!videoBase64 && pollJson?.response?.video?.bytesBase64Encoded) {
            videoBase64 = pollJson.response.video.bytesBase64Encoded;
          }
          
          // Structure 4: Videos array
          if (!videoBase64 && pollJson?.response?.videos) {
            const videos = pollJson.response.videos;
            if (videos.length > 0 && videos[0].bytesBase64Encoded) {
              videoBase64 = videos[0].bytesBase64Encoded;
            }
          }
          
          if (videoBase64) {
            const fileName = `educational_clip_${Date.now()}_${i}.mp4`;
            const clipPath = path.join(videoDir, fileName);
            
            await fs.promises.writeFile(clipPath, Buffer.from(videoBase64, 'base64'));
            videoClips.push(clipPath);
            
            log('vertex_clip_completed', { clip: fileName, shot: i + 1 });
          } else {
            // Log full response for debugging
            console.error(`No video data found in response for clip ${i + 1}. Full response:`, JSON.stringify(pollJson, null, 2));
            throw new Error(`No video data in response for clip ${i + 1}. Check logs for full response structure.`);
          }
        }
      } else {
        const errorText = await pollRes.text();
        log('vertex_poll_request_failed', { status: pollRes.status, error: errorText, shot: i + 1 });
      }
      
      attempts++;
    }

    if (!completed) {
      throw new Error(`Video generation timed out for clip ${i + 1} after ${maxAttempts} attempts`);
    }
  }

  // Check if we have clips to stitch
  if (videoClips.length === 0) {
    throw new Error('No video clips were generated successfully');
  }

  log('vertex_clips_ready_for_stitching', { count: videoClips.length });

  // Stitch clips together
  const ffmpeg = require('fluent-ffmpeg');
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

  const outputName = `educational_${Date.now()}.mp4`;
  const outputPath = path.join(videoDir, outputName);
  
  const concatListPath = path.join(videoDir, `concat_${Date.now()}.txt`);
  
  // Use absolute paths and ensure proper formatting
  const concatContent = videoClips
    .filter(f => f && fs.existsSync(f)) // Only include existing files
    .map(f => `file '${path.resolve(f)}'`) // Use absolute paths
    .join('\n');
  
  if (!concatContent) {
    throw new Error('No valid video clips to concatenate');
  }

  // Write concat file and ensure it's flushed to disk
  await fs.promises.writeFile(concatListPath, concatContent, 'utf8');
  
  // Verify concat file was written
  if (!fs.existsSync(concatListPath)) {
    throw new Error(`Failed to create concat list file at ${concatListPath}`);
  }

  log('concat_file_created', { path: concatListPath, clips: videoClips.length });

  // Add a small delay to ensure file system is ready
  await new Promise(r => setTimeout(r, 100));

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .on('start', (commandLine) => {
        log('ffmpeg_start', { command: commandLine });
      })
      .on('end', () => {
        log('ffmpeg_stitch_complete', { outputPath });
        resolve();
      })
      .on('error', (err) => {
        log('ffmpeg_stitch_error', { error: err.message });
        reject(err);
      })
      .save(outputPath);
  });

  // Clean up concat list file
  try {
    await fs.promises.unlink(concatListPath);
  } catch (e) {
    console.warn('Failed to delete concat list file:', e);
  }

  const videoUrl = `http://localhost:${process.env.PORT || 3005}/videos/${outputName}`;
  log('educational_video_complete', { videoUrl });
  
  return videoUrl;
};

/**
 * Main function: Generate complete educational video
 */
exports.generateEducationalVideo = async ({ chapter, topic, subject, level }) => {
  log('educational_video_generation_start', { chapter, topic, subject, level });

  // Step 1: Generate educational storyboard
  const storyboard = await generateEducationalStoryboard(chapter, topic, subject, level);

  // Step 2: Generate images for storyboard
  const storyboardWithImages = await generateEducationalImages(storyboard);

  // Step 3: Generate video from storyboard with images
  const videoUrl = await generateVideoWithVertex(storyboardWithImages);

  log('educational_video_generation_complete', { videoUrl });
  return videoUrl;
};