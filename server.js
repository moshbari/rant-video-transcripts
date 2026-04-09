const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');

const app = express();

// File upload config — 500MB max
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 500 * 1024 * 1024 }
});

// R2 config from environment variables
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'rantscripts-videos';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL; // e.g. https://pub-828b5621a07e4d509ef79d9d65f06653.r2.dev

// Initialize S3-compatible client for R2
let s3Client = null;
if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ACCOUNT_ID) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

// ===== Routes =====

// Serve static files (index.html, etc.)
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    storage: 'cloudflare-r2',
    bucket: R2_BUCKET_NAME,
    r2Connected: !!s3Client,
  });
});

// Video upload endpoint
app.post('/api/upload-video', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    if (!req.body.userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!req.body.videoNum) {
      return res.status(400).json({ error: 'videoNum is required' });
    }

    if (!s3Client) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'R2 storage not configured. Check environment variables.' });
    }

    // Build filename: username_video3_1712345678.mp4
    const ext = path.extname(req.file.originalname) || '.mp4';
    const safeName = req.body.userId.replace(/[^a-z0-9]/gi, '') + '_video' + req.body.videoNum + '_' + Date.now() + ext;
    const contentType = req.file.mimetype || 'video/mp4';

    console.log('[UPLOAD] Starting R2 upload:', safeName, '(' + (req.file.size / 1024 / 1024).toFixed(1) + ' MB)');

    // Read file and upload to R2
    const fileBuffer = fs.readFileSync(req.file.path);

    await s3Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: safeName,
      Body: fileBuffer,
      ContentType: contentType,
    }));

    // Clean up temp file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    // Build public URL
    const publicUrl = R2_PUBLIC_URL
      ? R2_PUBLIC_URL.replace(/\/$/, '') + '/' + safeName
      : `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${safeName}`;

    console.log('[UPLOAD] Success:', safeName, '\u2192', publicUrl);

    res.json({
      success: true,
      ghlUrl: publicUrl,   // kept as ghlUrl for frontend compatibility
      fileId: safeName,
      fileName: safeName,
    });

  } catch (err) {
    // Clean up temp file on error
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('[UPLOAD ERROR]', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ===== Start Server =====

async function init() {
  if (s3Client) {
    console.log('[R2] Connected to bucket "' + R2_BUCKET_NAME + '"');
    console.log('[R2] Public URL base: ' + (R2_PUBLIC_URL || 'using S3 endpoint'));
  } else {
    console.warn('[R2] Missing R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, or R2_ACCOUNT_ID.');
    console.warn('[R2] Video uploads will not work until these are set.');
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
  });
}

init();
