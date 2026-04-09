#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parse CLI arguments
const args = process.argv.slice(2);
let rcFolder = './Reaction Complete';
let outputPath = './index.html';
let templatePath = './template.html';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--rc-folder' && i + 1 < args.length) {
    rcFolder = args[i + 1];
    i++;
  } else if (args[i] === '--out' && i + 1 < args.length) {
    outputPath = args[i + 1];
    i++;
  } else if (args[i] === '--template' && i + 1 < args.length) {
    templatePath = args[i + 1];
    i++;
  }
}

// HTML escape function
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Extract video ID from YouTube URL
function extractVideoId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Get YouTube thumbnail URL
function getThumbnailUrl(videoId) {
  if (!videoId) return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="68"%3E%3Crect fill="%23333" width="120" height="68"/%3E%3C/svg%3E';
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

// Parse a single .txt file
function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const stat = fs.statSync(filePath);
  const mtime = stat.mtime;
  const lines = content.split('\n');

  if (lines.length < 2) return null;

  const title = lines[0].trim();
  const url = lines[1].trim();

  let dividerIdx = -1;
  for (let i = 2; i < lines.length; i++) {
    if (lines[i].trim() === '====') {
      dividerIdx = i;
      break;
    }
  }

  let transcript = '';
  let scriptsText = '';

  if (dividerIdx === -1) {
    // No divider, all content is treated as potential scripts
    scriptsText = lines.slice(2).join('\n');
  } else {
    // Content before divider is transcript
    transcript = lines.slice(2, dividerIdx).join('\n').trim();
    // Content after divider is scripts
    scriptsText = lines.slice(dividerIdx + 1).join('\n');
  }

  // Split scripts by reaction headers
  const reactionPattern = /^(?:REACTION\s+SCRIPT[- ]?\d+|Reaction\s+[Ss]cript[- ]?\d+:?|Reaction\s+Transcript[- ]?\d+:?)/im;
  const scriptBlocks = [];
  let currentBlock = '';
  let currentHeader = '';

  scriptsText.split('\n').forEach((line) => {
    if (reactionPattern.test(line.trim())) {
      if (currentBlock.trim()) {
        scriptBlocks.push({ header: currentHeader, body: currentBlock });
      }
      currentHeader = line.trim();
      currentBlock = '';
    } else {
      currentBlock += line + '\n';
    }
  });
  if (currentBlock.trim() || currentHeader) {
    scriptBlocks.push({ header: currentHeader, body: currentBlock });
  }

  // Format the file date as "Mar 28, 2026"
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const createdDate = `${months[mtime.getMonth()]} ${mtime.getDate()}, ${mtime.getFullYear()}`;

  return {
    title,
    url,
    transcript,
    scripts: scriptBlocks,
    createdDate,
  };
}

// Convert script text to HTML
function scriptToHtml(scriptText) {
  const lines = scriptText.split('\n');
  const html = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Section labels: [HOOK], [REACTION], [BRIDGE + CTA], etc.
    if (/^\[(HOOK|REACTION|BRIDGE\s+\+\s+CTA|BRIDGE|CTA|ALTERNATE\s+HOOK\s+\d+|ALTERNATE\s+BRIDGE\s+\+\s+CTA)\]$/i.test(trimmed)) {
      const label = trimmed.slice(1, -1).toUpperCase();
      html.push(`<span class="section-label">${escapeHtml(label)}</span>`);
      continue;
    }

    // Metadata lines (VIDEO TOPIC, CORE BELIEFS, etc.)
    const metaPatterns = [
      /^VIDEO\s+TOPIC:/i,
      /^CORE\s+BELIEFS:/i,
      /^GAP\s+IDENTIFIED:/i,
      /^BRIDGE\s+TYPE:/i,
      /^ESTIMATED\s+SPOKEN:/i,
      /^ALTERNATE\s+HOOKS?:/i,
      /^ALTERNATE\s+BRIDGE:/i,
    ];

    const isMetaLine = metaPatterns.some((pattern) => pattern.test(trimmed));
    if (isMetaLine) {
      html.push(`<p class="meta">${escapeHtml(trimmed)}</p>`);
      continue;
    }

    // Separator lines (--- or ====)
    if (/^-{3,}$/.test(trimmed)) {
      html.push('<hr class="thin">');
      continue;
    }
    if (/^={3,}$/.test(trimmed)) {
      continue; // Skip ==== separators between scripts
    }

    // Regular paragraph (dialogue)
    html.push(`<p>${escapeHtml(trimmed)}</p>`);
  }

  return html.join('\n');
}

// Generate a single video card
function generateVideoCard(data, videoNumber) {
  const { title, url, transcript, scripts, createdDate } = data;
  const videoId = extractVideoId(url);
  const thumbUrl = getThumbnailUrl(videoId);
  const titleLower = title.toLowerCase();
  const scriptCount = scripts.length;

  let html = `<div class="video-card" data-title="${escapeHtml(titleLower)}">\n`;
  html += `  <div class="card-header" onclick="toggleCard(this)">\n`;
  html += `    <div class="card-title-row">\n`;
  html += `      <img class="thumb" src="${escapeHtml(thumbUrl)}" alt="thumb" loading="lazy">\n`;
  html += `      <div>\n`;
  html += `        <h3>${escapeHtml(title)}</h3>\n`;
  if (url) {
    html += `        <a href="${escapeHtml(url)}" class="video-link" target="_blank">${escapeHtml(url)}</a>\n`;
  }
  html += `        <span class="script-count">${scriptCount} reaction script${scriptCount === 1 ? '' : 's'}</span>\n`;
  html += `        <span class="card-date">Added ${escapeHtml(createdDate)}</span>\n`;
  html += `      </div>\n`;
  html += `    </div>\n`;
  html += `    <span class="toggle-icon">▼</span>\n`;
  html += `  </div>\n`;
  html += `  <div class="card-body hidden">\n`;

  if (transcript.trim()) {
    html += `    <details class="transcript-details"><summary>View Original Transcript</summary><div class="transcript">${escapeHtml(title)}\n${escapeHtml(url)}\n\n${escapeHtml(transcript)}</div></details>\n`;
  }

  scripts.forEach((script, idx) => {
    const headerText = script.header || `REACTION SCRIPT ${idx + 1}`;
    const reactHtml = scriptToHtml(script.body);
    html += `    <div class="reaction-block"><h4>${escapeHtml(headerText)}</h4>${reactHtml}</div>\n`;
  });

  html += `  </div>\n`;
  html += `</div>\n`;

  return html;
}

// Main logic
try {
  // Read template
  if (!fs.existsSync(templatePath)) {
    console.error(`Error: template file not found at ${templatePath}`);
    process.exit(1);
  }
  const template = fs.readFileSync(templatePath, 'utf8');

  // Read all .txt files from RC folder
  if (!fs.existsSync(rcFolder)) {
    console.error(`Error: Reaction Complete folder not found at ${rcFolder}`);
    process.exit(1);
  }

  const files = fs.readdirSync(rcFolder).filter((f) => f.endsWith('.txt'));
  files.sort();

  // Parse all files
  const videos = [];
  let totalScripts = 0;
  files.forEach((file) => {
    const filePath = path.join(rcFolder, file);
    const data = parseFile(filePath);
    if (data) {
      videos.push(data);
      totalScripts += data.scripts.length;
    }
  });

  // Generate video cards HTML
  let videoCardsHtml = '';
  videos.forEach((data, idx) => {
    videoCardsHtml += generateVideoCard(data, idx + 1);
  });

  // Get current date
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Replace placeholders in template
  let output = template;
  output = output.replace('{{VIDEO_CARDS}}', videoCardsHtml);
  output = output.replace('{{TOTAL_VIDEOS}}', String(videos.length));
  output = output.replace('{{TOTAL_SCRIPTS}}', String(totalScripts));
  output = output.replace('{{LAST_UPDATED}}', dateStr);

  // Write output
  fs.writeFileSync(outputPath, output, 'utf8');

  // Log summary
  console.log(`✓ Site rebuilt successfully`);
  console.log(`  Videos: ${videos.length}`);
  console.log(`  Total scripts: ${totalScripts}`);
  console.log(`  Output: ${outputPath}`);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
