import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FFMPEG = "C:\\Users\\jrodr\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-essentials_build\\bin\\ffmpeg.exe";
const FRAMES_DIR = "C:\\Users\\jrodr\\AppData\\Local\\Temp\\hardkas_mastery_frames";
const OUT_MP4 = "c:\\Users\\jrodr\\Documents\\kaslabdevs\\GitHub\\harkasIDE\\hardkas_real_browser_recording.mp4";
const OUT_ARTIFACT = "C:\\Users\\jrodr\\.gemini\\antigravity\\brain\\9401271f-298c-4490-8b2a-b57ff67e4031\\hardkas_real_browser_recording.mp4";
const DEMO_PROJECT_PATH = "C:/Users/jrodr/hardkas-projects/demo-video";

if (fs.existsSync(FRAMES_DIR)) {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
}
fs.mkdirSync(FRAMES_DIR, { recursive: true });

console.log("Launching real Google Chrome...");
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

let frameCount = 0;
async function captureFrames(count = 10, delayMs = 60) {
  for (let i = 0; i < count; i++) {
    const filename = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, '0')}.png`);
    await page.screenshot({ path: filename });
    frameCount++;
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
}

// Ensure demo-video workspace is open in backend
console.log("Opening demo-video workspace...");
try {
  await fetch('http://127.0.0.1:7421/api/workspace/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: DEMO_PROJECT_PATH })
  });
} catch (e) {
  console.log("Open workspace API note:", e.message);
}

await page.goto('http://127.0.0.1:7421/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2000));
console.log("Captured initial load");
await captureFrames(20, 60);

// 1. Files Panel - Open auction.sil
console.log("Opening contracts/auction.sil...");
await page.evaluate(() => {
  // Find file row with auction.sil
  const rows = Array.from(document.querySelectorAll('*'));
  const fileRow = rows.find(el => el.textContent && el.textContent.trim() === 'auction.sil');
  if (fileRow) {
    fileRow.click();
  }
});
await new Promise(r => setTimeout(r, 1200));
await captureFrames(25, 60);

// 2. Click Covenant Graph in IconRail
console.log("Clicking Covenant Graph...");
await page.evaluate(() => {
  const btn = document.querySelector('button[title*="Covenant"]');
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));
await captureFrames(25, 60);

// 3. Click Lineage in IconRail
console.log("Clicking Lineage...");
await page.evaluate(() => {
  const btn = document.querySelector('button[title*="Lineage"]');
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));
await captureFrames(25, 60);

// 4. Click Servers Panel in IconRail
console.log("Clicking Servers Panel...");
await page.evaluate(() => {
  const btn = document.querySelector('button[title*="Servers"]');
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));
await captureFrames(30, 60);

// 5. Click Accounts Panel in IconRail
console.log("Clicking Accounts Panel...");
await page.evaluate(() => {
  const btn = document.querySelector('button[title*="Accounts"]');
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));
await captureFrames(30, 60);

// 6. Click SilverScript Compiler Panel in IconRail
console.log("Clicking SilverScript Panel...");
await page.evaluate(() => {
  const btn = document.querySelector('button[title*="Silver"]');
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));
await captureFrames(25, 60);

// 7. Click Tests Panel in IconRail
console.log("Clicking Tests Panel...");
await page.evaluate(() => {
  const btn = document.querySelector('button[title*="Tests"]');
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));
await captureFrames(25, 60);

await browser.close();
console.log(`Captured total ${frameCount} frames.`);

// Encode to MP4 with Gyan FFmpeg Essentials
console.log("Encoding MP4 video with Gyan FFmpeg...");
const cmd = `"${FFMPEG}" -y -framerate 12 -i "${FRAMES_DIR}\\frame_%05d.png" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${OUT_MP4}"`;
execSync(cmd);
console.log("MP4 generated at:", OUT_MP4);

// Copy to artifact directory
fs.copyFileSync(OUT_MP4, OUT_ARTIFACT);
console.log("MP4 copied to artifact directory:", OUT_ARTIFACT);

// Clean temporary frames
fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
console.log("Temporary frames cleaned up.");
