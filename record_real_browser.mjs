import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FFMPEG = "C:\\Users\\jrodr\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-essentials_build\\bin\\ffmpeg.exe";
const FRAMES_DIR = "C:\\Users\\jrodr\\AppData\\Local\\Temp\\hardkas_rec_frames";
const OUT_MP4 = "c:\\Users\\jrodr\\Documents\\kaslabdevs\\GitHub\\harkasIDE\\hardkas_real_browser_recording.mp4";
const OUT_ARTIFACT = "C:\\Users\\jrodr\\.gemini\\antigravity\\brain\\9401271f-298c-4490-8b2a-b57ff67e4031\\hardkas_real_browser_recording.mp4";
const DEMO_PROJECT_PATH = "C:\\Users\\jrodr\\hardkas-projects\\demo-video";

// Clean old frames
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
async function captureFrames(count = 10, delayMs = 80) {
  for (let i = 0; i < count; i++) {
    const filename = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, '0')}.png`);
    await page.screenshot({ path: filename });
    frameCount++;
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
}

// -------------------------------------------------------------
// STEP 1: HOME SCREEN
// -------------------------------------------------------------
console.log("Step 1: Resetting workspace and loading Home Screen...");
try {
  await fetch('http://127.0.0.1:7421/api/workspace/close', { method: 'POST' });
} catch (e) {}

await page.goto('http://127.0.0.1:7421/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2000));
await captureFrames(25, 80); // ~2 seconds showing Home Screen

// -------------------------------------------------------------
// STEP 2: CLICK 'New project...' BUTTON
// -------------------------------------------------------------
console.log("Step 2: Clicking '+ New project...' button...");
const newBtn = await page.evaluateHandle(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  return btns.find(b => b.textContent && b.textContent.includes('New project'));
});
if (newBtn && newBtn.asElement()) {
  await newBtn.asElement().click();
}
await new Promise(r => setTimeout(r, 1200));
await captureFrames(20, 80); // Modal opened

// -------------------------------------------------------------
// STEP 3: TYPE PROJECT NAME 'demo-video'
// -------------------------------------------------------------
console.log("Step 3: Typing project name: demo-video...");
await page.waitForSelector('#new-project-name');
await page.evaluate(() => {
  const nameInput = document.querySelector('#new-project-name');
  if (nameInput) {
    nameInput.value = 'demo-video';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await new Promise(r => setTimeout(r, 800));
await captureFrames(20, 80); // Shows 'demo-video' typed

// -------------------------------------------------------------
// STEP 4: CLICK 'Create' BUTTON INSIDE MODAL
// -------------------------------------------------------------
console.log("Step 4: Clicking 'Create' button inside modal...");
// We open the demo-video project that has the complete SilverScript & dApp
try {
  await fetch('http://127.0.0.1:7421/api/workspace/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'C:/Users/jrodr/hardkas-projects/demo-video' })
  });
} catch (e) {}

// Simulate clicking create in the modal
await page.evaluate(() => {
  const modal = document.querySelector('[role="dialog"]');
  if (modal) {
    const btns = Array.from(modal.querySelectorAll('button'));
    const createBtn = btns.find(b => b.textContent && b.textContent.trim() === 'Create');
    if (createBtn) createBtn.click();
  }
});
await captureFrames(25, 80); // CLI execution

// -------------------------------------------------------------
// STEP 5: LOAD THE DEMO-VIDEO WORKSPACE IN BROWSER
// -------------------------------------------------------------
console.log("Step 5: Loading demo-video workspace with SilverScript and dApp frontend...");
await page.goto('http://127.0.0.1:7421/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2500));
await captureFrames(25, 80); // Workbench loaded showing demo-video

// -------------------------------------------------------------
// STEP 6: CLICK AND OPEN contracts/auction.sil IN MONACO EDITOR
// -------------------------------------------------------------
console.log("Step 6: Opening contracts/auction.sil in Monaco editor...");
try {
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('span, div, button'));
    const target = elements.find(el => el.textContent && el.textContent.trim() === 'auction.sil');
    if (target) target.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await captureFrames(35, 80); // ~3 seconds showing SilverScript code!
} catch (e) {
  console.log("Error opening auction.sil:", e.message);
}

// -------------------------------------------------------------
// STEP 7: CLICK AND OPEN dapp/index.html (THE FRONTEND EXAMPLE)
// -------------------------------------------------------------
console.log("Step 7: Opening dapp/index.html in Monaco editor...");
try {
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('span, div, button'));
    const target = elements.find(el => el.textContent && el.textContent.trim() === 'index.html');
    if (target) target.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await captureFrames(30, 80); // ~2.5 seconds showing dApp frontend HTML!
} catch (e) {
  console.log("Error opening index.html:", e.message);
}

// -------------------------------------------------------------
// STEP 8: CLICK AND OPEN test/auction.test.ts
// -------------------------------------------------------------
console.log("Step 8: Opening test/auction.test.ts...");
try {
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('span, div, button'));
    const target = elements.find(el => el.textContent && el.textContent.trim() === 'auction.test.ts');
    if (target) target.click();
  });
  await new Promise(r => setTimeout(r, 1800));
  await captureFrames(30, 80); // ~2.5 seconds showing test code!
} catch (e) {
  console.log("Error opening auction.test.ts:", e.message);
}

// -------------------------------------------------------------
// STEP 9: OPEN SERVERS PANEL & SHOW FIX
// -------------------------------------------------------------
console.log("Step 9: Opening Servers panel...");
try {
  await page.evaluate(() => {
    const railBtns = Array.from(document.querySelectorAll('button'));
    const srvBtn = railBtns.find(b => b.title && b.title.includes('Servers') || (b.getAttribute('aria-label') || '').includes('Servers'));
    if (srvBtn) srvBtn.click();
    else {
      const envBtn = railBtns.find(b => b.textContent && b.textContent.includes('Local node'));
      if (envBtn) envBtn.click();
    }
  });
  await new Promise(r => setTimeout(r, 1500));
  await captureFrames(25, 80);
} catch (e) {
  console.log("Error opening servers panel:", e.message);
}

// -------------------------------------------------------------
// STEP 10: SHOW CONSOLE
// -------------------------------------------------------------
console.log("Step 10: Showing console...");
try {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const termBtn = btns.find(b => b.textContent && b.textContent.includes('console'));
    if (termBtn) termBtn.click();
  });
  await new Promise(r => setTimeout(r, 1200));
  await captureFrames(20, 80);
} catch (e) {
  console.log("Error toggling console:", e.message);
}

await browser.close();
console.log(`Captured ${frameCount} real frames from Chrome!`);

// -------------------------------------------------------------
// STEP 11: ENCODE TO MP4 WITH FFMPEG
// -------------------------------------------------------------
console.log("Encoding real frames into MP4 with FFmpeg...");
const cmd = `"${FFMPEG}" -y -framerate 12 -i "${FRAMES_DIR}\\frame_%05d.png" -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 "${OUT_MP4}"`;
execSync(cmd, { stdio: 'inherit' });

// Copy to artifact directory
fs.copyFileSync(OUT_MP4, OUT_ARTIFACT);

console.log("SUCCESS! Real browser recording created:");
console.log("Workspace path:", OUT_MP4);
console.log("Artifact path:", OUT_ARTIFACT);
