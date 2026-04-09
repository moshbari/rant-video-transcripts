const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();

// File upload config — 500MB max (GHL limit)
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 500 * 1024 * 1024 }
});

// GHL config from environment variables
const GHL_TOKEN = process.env.GHL_TOKEN;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_FOLDER_NAME = process.env.GHL_FOLDER_NAME || 'rantscripts.1min.site videos';
let ghlFolderId = null;

// ===== GHL API Functions (curl via execSync — the ONLY way that works) =====

function findFolderId(folderName) {
  let cmd = 'curl -s -X GET "https://services.leadconnectorhq.com/medias/files';
  cmd += '?altId=' + GHL_LOCATION_ID + '&altType=location&type=folder&limit=100"';
  cmd += ' -H "Authorization: Bearer ' + GHL_TOKEN + '"';
  cmd += ' -H "Version: 2021-07-28"';
  const data = JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 30000 }));
  const folder = (data.files || []).find(f => f.name === folderName);
  return folder ? folder._id : null; // USE ._id NOT .id
}

function uploadToGHL(filePath, fileName, contentType, folderId) {
  let cmd = 'curl -s -X POST "https://services.leadconnectorhq.com/medias/upload-file"';
  cmd += ' -H "Authorization: Bearer ' + GHL_TOKEN + '"';
  cmd += ' -H "Version: 2021-07-28"';
  cmd += ' -F "file=@' + filePath + ';type=' + contentType + '"';
  cmd += ' -F "hosted=false"';
  cmd += ' -F "name=' + fileName + '"';
  cmd += ' -F "altId=' + GHL_LOCATION_ID + '"';
  cmd += ' -F "altType=location"';
  if (folderId) cmd += ' -F "parentId=' + folderId + '"';
  const result = execSync(cmd, { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(result);
}

// ===== Routes =====

// Serve static files (index.html, etc.)
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ghlFolder: GHL_FOLDER_NAME,
    ghlFolderId: ghlFolderId || 'not resolved yet',
  });
});

// Video upload endpoint
app.post('/api/upload-video', upload.single('video'), (req, res) => {
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

    // Ensure we have the GHL folder ID
    if (!ghlFolderId) {
      ghlFolderId = findFolderId(GHL_FOLDER_NAME);
      if (!ghlFolderId) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: 'GHL folder "' + GHL_FOLDER_NAME + '" not found' });
      }
    }

    // Build filename: username_video3_1712345678.mp4
    const ext = path.extname(req.file.originalname) || '.mp4';
    const safeName = req.body.userId.replace(/[^a-z0-9]/gi, '') + '_video' + req.body.videoNum + '_' + Date.now() + ext;
    const contentType = req.file.mimetype || 'video/mp4';

    console.log('[UPLOAD] Starting GHL upload:', safeName, '(' + (req.file.size / 1024 / 1024).toFixed(1) + ' MB)');

    // Upload to GHL
    const result = uploadToGHL(req.file.path, safeName, contentType, ghlFolderId);

    // Clean up temp file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    console.log('[UPLOAD] Success:', safeName, '→', result.url || result.fileUrl);

    res.json({
      success: true,
      ghlUrl: result.url || result.fileUrl,
      fileId: result.fileId,
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
  // Resolve GHL folder ID on startup
  if (GHL_TOKEN && GHL_LOCATION_ID) {
    try {
      ghlFolderId = findFolderId(GHL_FOLDER_NAME);
      console.log('[GHL] Folder "' + GHL_FOLDER_NAME + '" → _id: ' + ghlFolderId);
    } catch (err) {
      console.warn('[GHL] Could not resolve folder on startup:', err.message);
      console.warn('[GHL] Will retry on first upload request.');
    }
  } else {
    console.warn('[GHL] Missing GHL_TOKEN or GHL_LOCATION_ID environment variables.');
    console.warn('[GHL] Video uploads will not work until these are set.');
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
  });
}

init();
