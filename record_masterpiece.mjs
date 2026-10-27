import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FFMPEG = "C:\\Users\\jrodr\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-essentials_build\\bin\\ffmpeg.exe";
const FRAMES_DIR = "C:\\Users\\jrodr\\AppData\\Local\\Temp\\hardkas_tienda_frames";
const OUT_MP4 = "c:\\Users\\jrodr\\Documents\\kaslabdevs\\GitHub\\harkasIDE\\hardkas_real_browser_recording.mp4";
const OUT_ARTIFACT = "C:\\Users\\jrodr\\.gemini\\antigravity\\brain\\9401271f-298c-4490-8b2a-b57ff67e4031\\hardkas_real_browser_recording.mp4";

if (fs.existsSync(FRAMES_DIR)) {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
}
fs.mkdirSync(FRAMES_DIR, { recursive: true });

console.log("Launching Google Chrome for 'mi-tienda-kaspa' Recording...");
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://127.0.0.1:7421/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2200));

// Inject realistic cursor and click ripple
await page.evaluate(() => {
  const cursor = document.createElement('div');
  cursor.id = 'hk-virtual-cursor';
  cursor.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.8));">
      <path d="M4 4L13 24L16.5 15.5L25 12L4 4Z" fill="#10B981" stroke="#FFFFFF" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>
  `;
  cursor.style.position = 'fixed';
  cursor.style.top = '0px';
  cursor.style.left = '0px';
  cursor.style.zIndex = '9999999';
  cursor.style.pointerEvents = 'none';
  cursor.style.transform = 'translate(640px, 400px)';
  cursor.style.transition = 'none';
  document.body.appendChild(cursor);

  window.__cursorX = 640;
  window.__cursorY = 400;

  window.__setCursorPos = (x, y) => {
    window.__cursorX = x;
    window.__cursorY = y;
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  };

  window.__triggerClickPulse = () => {
    const pulse = document.createElement('div');
    pulse.style.position = 'fixed';
    pulse.style.left = `${window.__cursorX}px`;
    pulse.style.top = `${window.__cursorY}px`;
    pulse.style.width = '24px';
    pulse.style.height = '24px';
    pulse.style.borderRadius = '50%';
    pulse.style.border = '2px solid #10B981';
    pulse.style.background = 'rgba(16, 185, 129, 0.45)';
    pulse.style.zIndex = '9999998';
    pulse.style.pointerEvents = 'none';
    pulse.style.transform = 'translate(-50%, -50%) scale(1)';
    pulse.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
    document.body.appendChild(pulse);
    setTimeout(() => {
      pulse.style.transform = 'translate(-50%, -50%) scale(3)';
      pulse.style.opacity = '0';
      setTimeout(() => pulse.remove(), 300);
    }, 15);
  };
});

let frameCount = 0;
async function captureFrames(count = 1) {
  for (let i = 0; i < count; i++) {
    const filename = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, '0')}.png`);
    await page.screenshot({ path: filename });
    frameCount++;
  }
}

async function moveCursor(targetX, targetY, steps = 8) {
  const current = await page.evaluate(() => ({ x: window.__cursorX, y: window.__cursorY }));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const x = Math.round(current.x + (targetX - current.x) * ease);
    const y = Math.round(current.y + (targetY - current.y) * ease);
    await page.evaluate((cx, cy) => window.__setCursorPos(cx, cy), x, y);
    await captureFrames(1);
  }
  await page.evaluate((tx, ty) => window.__setCursorPos(tx, ty), targetX, targetY);
  await captureFrames(1);
}

async function clickAt(x, y) {
  await moveCursor(x, y, 7);
  await page.evaluate(() => window.__triggerClickPulse());
  await captureFrames(2);
  await page.mouse.click(x, y);
  await captureFrames(3);
}

// -------------------------------------------------------------------------------------------------
// ACTO 1: EXPLORADOR - APERTURA DE 'contracts/tienda.sil' EN EL PROYECTO NUEVO 'mi-tienda-kaspa'
// -------------------------------------------------------------------------------------------------
console.log("Acto 1: Apertura de contracts/tienda.sil...");
await captureFrames(15);

// Clic en Explorer
await clickAt(24, 98);
await captureFrames(10);

// Asegurar que la carpeta 'contracts' esté expandida y pulsar 'tienda.sil'
const silCoords = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('[role="treeitem"]'));
  const contractsFolder = items.find(el => el.textContent && el.textContent.trim().startsWith('contracts'));
  if (contractsFolder && contractsFolder.getAttribute('aria-expanded') === 'false') {
    contractsFolder.click();
  }
  const el = document.querySelector('[title="contracts/tienda.sil"]');
  if (el) {
    el.click();
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return { x: 120, y: 220 };
});

await clickAt(silCoords.x, silCoords.y);
console.log("Archivo contracts/tienda.sil seleccionado, esperando Monaco...");
await new Promise(r => setTimeout(r, 1500));
await captureFrames(15);

// Enfocar Monaco Editor y escribir código en vivo
console.log("Acto 1b: Escribiendo regla en Monaco Editor...");
await clickAt(650, 240);
await page.keyboard.press('ArrowUp');
await page.keyboard.press('End');
await page.keyboard.press('Enter');

const codeComment = "    // Contrato de Escrow Verificado en Vivo para Kaspa L1";
for (const char of codeComment) {
  await page.keyboard.type(char);
  if (Math.random() > 0.6) await captureFrames(1);
}
await captureFrames(20);

// -------------------------------------------------------------------------------------------------
// ACTO 2: COMPILACIÓN DEL CONTRATO EN EL PANEL SILVERSCRIPT
// -------------------------------------------------------------------------------------------------
console.log("Acto 2: Compilando en el panel SilverScript...");
const silverNavPos = await page.evaluate(() => {
  const btn = document.querySelector('nav button[title*="Silver"]');
  if (btn) {
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return { x: 24, y: 242 };
});
await clickAt(silverNavPos.x, silverNavPos.y);
await captureFrames(15);

// Clic en Compile
const compileBtnPos = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const b = btns.find(btn => btn.textContent && btn.textContent.includes('Compile'));
  if (b) {
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return null;
});

if (compileBtnPos) {
  await clickAt(compileBtnPos.x, compileBtnPos.y);
  console.log("Botón Compile pulsado, esperando resultado...");
  await new Promise(r => setTimeout(r, 2000));
  await captureFrames(30);
}

// -------------------------------------------------------------------------------------------------
// ACTO 3: INSPECCIÓN DEL GRAFO DE COVENANTS (COVENANT GRAPH)
// -------------------------------------------------------------------------------------------------
console.log("Acto 3: Inspeccionando el Grafo de Covenants...");
const covNavPos = await page.evaluate(() => {
  const btn = document.querySelector('nav button[title="Covenant Graph"]');
  if (btn) {
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return { x: 24, y: 506 };
});
await clickAt(covNavPos.x, covNavPos.y);
await captureFrames(30);

// -------------------------------------------------------------------------------------------------
// ACTO 4: SUITE DE PRUEBAS EN VITEST
// -------------------------------------------------------------------------------------------------
console.log("Acto 4: Abriendo Tests y ejecutando Vitest...");
const testsNavPos = await page.evaluate(() => {
  const btn = document.querySelector('nav button[title="Tests"]');
  if (btn) {
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return { x: 24, y: 349 };
});
await clickAt(testsNavPos.x, testsNavPos.y);
await captureFrames(15);

const runAllBtnPos = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const b = btns.find(btn => btn.textContent && btn.textContent.includes('Run all'));
  if (b) {
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return null;
});

if (runAllBtnPos) {
  await clickAt(runAllBtnPos.x, runAllBtnPos.y);
  console.log("Ejecutando tests con Vitest...");
  await new Promise(r => setTimeout(r, 3000));
  await captureFrames(35);
}

// -------------------------------------------------------------------------------------------------
// ACTO 5: DEPLOY & RUN - INSTANCIA DESPLEGADA DE TIENDAESCROW (25 KAS) Y GASTO
// -------------------------------------------------------------------------------------------------
console.log("Acto 5: Abriendo Deploy & Run...");
const runNavPos = await page.evaluate(() => {
  const btn = document.querySelector('nav button[title="Deploy & Run"]');
  if (btn) {
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return { x: 24, y: 277 };
});
await clickAt(runNavPos.x, runNavPos.y);
await captureFrames(25);

// Clic en 'Plan → Sign → Send' o interactuar con el contrato
const planSignSendPos = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const b = btns.find(btn => btn.textContent && (btn.textContent.includes('Plan → Sign → Send') || btn.textContent.includes('Plan, sign & send')));
  if (b) {
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return null;
});

if (planSignSendPos) {
  await clickAt(planSignSendPos.x, planSignSendPos.y);
  console.log("Transacción de pago ejecutada en localnet...");
  await new Promise(r => setTimeout(r, 2500));
  await captureFrames(35);
}

// -------------------------------------------------------------------------------------------------
// ACTO 6: LINAJE CAUSAL EN EL BLOCKDAG
// -------------------------------------------------------------------------------------------------
console.log("Acto 6: Abriendo vista de Linaje Causal...");
const linNavPos = await page.evaluate(() => {
  const btn = document.querySelector('nav button[title="Lineage"]');
  if (btn) {
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return { x: 24, y: 542 };
});
await clickAt(linNavPos.x, linNavPos.y);
await captureFrames(30);

// -------------------------------------------------------------------------------------------------
// ACTO 7: PANEL DE SERVIDORES (NODO DOCKER TOCCATA Y SALDOS REALES DE ALICE Y BOB)
// -------------------------------------------------------------------------------------------------
console.log("Acto 7: Verificando Servidores y Saldos...");
const servNavPos = await page.evaluate(() => {
  const btn = document.querySelector('nav button[title="Servers"]');
  if (btn) {
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return { x: 24, y: 134 };
});
await clickAt(servNavPos.x, servNavPos.y);
await captureFrames(25);

await browser.close();
console.log(`Grabación completada: ${frameCount} fotogramas capturados.`);

// Codificar con Gyan FFmpeg
console.log("Codificando vídeo MP4 en alta calidad con Gyan FFmpeg...");
const ffmpegCmd = `"${FFMPEG}" -y -framerate 14 -i "${FRAMES_DIR}\\frame_%05d.png" -c:v libx264 -crf 19 -pix_fmt yuv420p -movflags +faststart "${OUT_MP4}"`;
execSync(ffmpegCmd);
console.log("Vídeo final MP4 generado en:", OUT_MP4);

// Copiar al directorio de artefactos
fs.copyFileSync(OUT_MP4, OUT_ARTIFACT);
console.log("Vídeo copiado al directorio de artefactos:", OUT_ARTIFACT);

// Limpiar fotogramas
fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
console.log("Fotogramas temporales eliminados con éxito.");
