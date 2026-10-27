import os
import subprocess
from PIL import Image, ImageDraw, ImageFont

# Dimensions and timing
W, H = 1280, 720
FPS = 25
TOTAL_SECS = 25
TOTAL_FRAMES = FPS * TOTAL_SECS

# Paths
FFMPEG = r"C:\Users\jrodr\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-essentials_build\bin\ffmpeg.exe"
OUT_WORKSPACE = r"c:\Users\jrodr\Documents\kaslabdevs\GitHub\harkasIDE\hardkas_ide_demo.mp4"
OUT_ARTIFACT = r"C:\Users\jrodr\.gemini\antigravity\brain\9401271f-298c-4490-8b2a-b57ff67e4031\hardkas_ide_demo.mp4"

# Fonts
try:
    FONT_UI = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 13)
    FONT_UI_BOLD = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 13)
    FONT_UI_TITLE = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 16)
    FONT_MONO = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 12)
    FONT_MONO_BOLD = ImageFont.truetype(r"C:\Windows\Fonts\consolab.ttf", 12)
    FONT_MONO_SM = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 10)
    FONT_SUBTITLE = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 14)
except Exception:
    FONT_UI = FONT_UI_BOLD = FONT_UI_TITLE = FONT_MONO = FONT_MONO_BOLD = FONT_MONO_SM = FONT_SUBTITLE = ImageFont.load_default()

# Colors
BG_DARK = (11, 15, 25)
BG_HEADER = (13, 19, 34)
BG_PANEL = (15, 20, 35)
BG_STAGE = (7, 11, 19)
BORDER_COLOR = (38, 51, 77)
TEXT_MAIN = (226, 232, 240)
TEXT_MUTED = (148, 163, 184)
TEXT_DIM = (100, 116, 139)
TEAL_KAS = (52, 211, 153)
TEAL_BG = (16, 60, 45)
PURPLE_SYN = (192, 132, 252)
BLUE_SYN = (96, 165, 250)
AMBER_SYN = (251, 191, 36)

def draw_ide_frame(d, title, active_tab="hardkas.config.ts", env_node_ready=True):
    # Top Window Bar
    d.rectangle([0, 0, W, 32], fill=(9, 13, 22))
    d.line([0, 32, W, 32], fill=BORDER_COLOR)
    
    # Traffic lights
    d.ellipse([12, 10, 22, 20], fill=(239, 68, 68))
    d.ellipse([28, 10, 38, 20], fill=(245, 158, 11))
    d.ellipse([44, 10, 54, 20], fill=(52, 211, 153))
    
    d.text((70, 8), "HardKas IDE", fill=TEAL_KAS, font=FONT_UI_BOLD)
    d.text((160, 9), "File   Edit   Run   Terminal   Help", fill=TEXT_MUTED, font=FONT_UI)
    
    # Center title pill
    pill_w = 340
    pill_x = (W - pill_w) // 2
    d.rounded_rectangle([pill_x, 5, pill_x + pill_w, 27], radius=4, fill=(15, 23, 42), outline=BORDER_COLOR)
    d.text((pill_x + 12, 8), title, fill=TEXT_MAIN, font=FONT_MONO_SM)
    
    # Window controls
    d.text((W - 60, 7), "--   [ ]   X", fill=TEXT_DIM, font=FONT_MONO)
    
    # EnvBar
    d.rectangle([0, 33, W, 62], fill=BG_PANEL)
    d.line([0, 62, W, 62], fill=BORDER_COLOR)
    
    d.text((12, 40), "env", fill=TEXT_DIM, font=FONT_MONO_SM)
    d.rounded_rectangle([42, 38, 210, 57], radius=4, fill=TEAL_BG, outline=TEAL_KAS)
    d.text((50, 40), "Local node (Docker, simnet)", fill=TEAL_KAS, font=FONT_UI_BOLD)
    
    if env_node_ready:
        d.ellipse([225, 45, 233, 53], fill=TEAL_KAS)
        d.text((240, 40), "rusty-kaspad 0.14.2 · simnet · ready · DAA 342,116", fill=TEXT_MAIN, font=FONT_MONO_SM)
        d.text((620, 40), "alice: 100.00 KAS   bob: 10.00 KAS", fill=TEAL_KAS, font=FONT_MONO_SM)
    else:
        d.ellipse([225, 45, 233, 53], fill=(239, 68, 68))
        d.text((240, 40), "rusty-kaspad · stopped", fill=(248, 113, 113), font=FONT_MONO_SM)
        d.text((450, 40), "cuentas inactivas (nodo apagado)", fill=TEXT_MUTED, font=FONT_MONO_SM)
    
    # Left Activity Bar (x: 0 to 45)
    d.rectangle([0, 63, 45, H - 24], fill=(9, 13, 22))
    d.line([45, 63, 45, H - 24], fill=BORDER_COLOR)
    
    # Status Bar (Bottom)
    d.rectangle([0, H - 24, W, H], fill=(9, 13, 22))
    d.line([0, H - 24, W, H - 24], fill=BORDER_COLOR)
    d.text((12, H - 18), "main*   kaspa-payment-app   ✓ 0 Errors   UTF-8   HardKas IDE 0.1", fill=TEXT_MUTED, font=FONT_MONO_SM)

def draw_cursor(d, x, y, badge=None):
    # Cursor polygon
    pts = [(x, y), (x + 14, y + 10), (x + 6, y + 11), (x + 10, y + 18), (x + 7, y + 19), (x + 3, y + 12), (x, y + 15)]
    d.polygon(pts, fill=TEAL_KAS, outline=(255, 255, 255))
    if badge:
        tw = int(d.textlength(badge, font=FONT_MONO_SM))
        d.rounded_rectangle([x + 18, y, x + 24 + tw, y + 18], radius=3, fill=(0, 0, 0), outline=TEAL_KAS)
        d.text((x + 21, y + 2), badge, fill=TEAL_KAS, font=FONT_MONO_SM)

def draw_subtitle(d, text):
    tw = int(d.textlength(text, font=FONT_SUBTITLE))
    bx = (W - tw - 40) // 2
    by = H - 65
    d.rounded_rectangle([bx, by, bx + tw + 40, by + 32], radius=16, fill=(0, 0, 0), outline=TEAL_KAS)
    d.ellipse([bx + 14, by + 12, bx + 22, by + 20], fill=TEAL_KAS)
    d.text((bx + 28, by + 6), text, fill=(255, 255, 255), font=FONT_SUBTITLE)

def render_frame(t):
    # t in [0..25] seconds
    img = Image.new("RGB", (W, H), BG_DARK)
    d = ImageDraw.Draw(img)
    
    if t < 5.0:
        # Chapter 1: Home Screen & New Project Dialog
        draw_ide_frame(d, "HardKas IDE - Home Screen", env_node_ready=False)
        
        # Center Stage Background
        d.rectangle([46, 63, W, H - 24], fill=(11, 15, 25))
        d.text((80, 100), "HardKas IDE", fill=TEAL_KAS, font=FONT_UI_TITLE)
        d.text((80, 130), "Visual Studio-style workbench for Kaspa & SilverScript", fill=TEXT_MUTED, font=FONT_UI)
        
        # Dialog Box
        dw, dh = 720, 420
        dx, dy = (W - dw) // 2, 140
        d.rounded_rectangle([dx, dy, dx + dw, dy + dh], radius=8, fill=(15, 20, 35), outline=BORDER_COLOR)
        
        # Dialog header
        d.rectangle([dx, dy, dx + dw, dy + 36], fill=(20, 27, 45))
        d.line([dx, dy + 36, dx + dw, dy + 36], fill=BORDER_COLOR)
        d.text((dx + 16, dy + 9), "Create a new HardKas project", fill=(255, 255, 255), font=FONT_UI_BOLD)
        d.text((dx + dw - 24, dy + 9), "X", fill=TEXT_MUTED, font=FONT_UI)
        
        # Left: Templates
        d.text((dx + 20, dy + 50), "PROJECT TEMPLATES", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # Selected Template: Payment App
        d.rounded_rectangle([dx + 20, dy + 70, dx + 420, dy + 150], radius=6, fill=TEAL_BG, outline=TEAL_KAS, width=2)
        d.text((dx + 32, dy + 82), "Payment app", fill=(255, 255, 255), font=FONT_UI_BOLD)
        d.rounded_rectangle([dx + 320, dy + 80, dx + 408, dy + 98], radius=3, fill=(16, 185, 129), outline=TEAL_KAS)
        d.text((dx + 326, dy + 82), "OFICIAL", fill=(0, 0, 0), font=FONT_MONO_SM)
        d.text((dx + 32, dy + 105), "Plan, sign and simulate a Kaspa payment end to end.", fill=TEXT_MUTED, font=FONT_UI)
        d.text((dx + 32, dy + 125), "Incluye: hardkas.config.ts, @hardkas/sdk, test/payment.test.ts", fill=TEAL_KAS, font=FONT_MONO_SM)
        
        # Template 2: Basic project
        d.rounded_rectangle([dx + 20, dy + 160, dx + 420, dy + 220], radius=6, fill=(11, 15, 25), outline=BORDER_COLOR)
        d.text((dx + 32, dy + 172), "Basic project (hardkas init)", fill=TEXT_MAIN, font=FONT_UI_BOLD)
        d.text((dx + 32, dy + 195), "hardkas.config.ts, payment test and simulator.", fill=TEXT_MUTED, font=FONT_UI)
        
        # Right: Config Form
        fx = dx + 440
        d.line([fx - 10, dy + 50, fx - 10, dy + 390], fill=BORDER_COLOR)
        d.text((fx, dy + 60), "Project Name", fill=TEXT_MAIN, font=FONT_UI_BOLD)
        d.rounded_rectangle([fx, dy + 82, dx + dw - 24, dy + 112], radius=4, fill=(11, 15, 25), outline=TEAL_KAS)
        d.text((fx + 10, dy + 90), "kaspa-payment-app", fill=TEAL_KAS, font=FONT_MONO)
        
        d.text((fx, dy + 130), "Destination", fill=TEXT_MAIN, font=FONT_UI_BOLD)
        d.rounded_rectangle([fx, dy + 152, dx + dw - 24, dy + 182], radius=4, fill=(11, 15, 25), outline=BORDER_COLOR)
        d.text((fx + 10, dy + 160), "~/hardkas-projects/kaspa-payment-app", fill=TEXT_MUTED, font=FONT_MONO_SM)
        
        d.text((fx, dy + 205), "$ hardkas create payment-app", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # Create Button
        btn_y = dy + 330
        d.rounded_rectangle([fx, btn_y, dx + dw - 24, btn_y + 36], radius=6, fill=(16, 185, 129), outline=TEAL_KAS)
        d.text((fx + 55, btn_y + 9), "+ Create project", fill=(0, 0, 0), font=FONT_UI_BOLD)
        
        # Cursor
        cx = int(fx + 100 + (t / 5.0) * 10)
        cy = int(btn_y + 15)
        draw_cursor(d, cx, cy, "Click")
        draw_subtitle(d, "Paso 1: Creamos una nueva aplicación en el Wizard con la plantilla oficial 'Payment App'")
        
    elif t < 10.0:
        # Chapter 2: Workspace Loaded & hardkas.config.ts
        draw_ide_frame(d, "kaspa-payment-app / hardkas.config.ts", env_node_ready=False)
        
        # Left Explorer Panel (x: 46 to 260)
        d.rectangle([46, 63, 260, H - 24], fill=BG_PANEL)
        d.line([260, 63, 260, H - 24], fill=BORDER_COLOR)
        
        d.text((58, 75), "EXPLORER", fill=TEXT_DIM, font=FONT_MONO_SM)
        d.text((58, 98), "> kaspa-payment-app", fill=TEXT_MAIN, font=FONT_UI_BOLD)
        
        # File Tree
        d.rounded_rectangle([70, 120, 250, 142], radius=4, fill=TEAL_BG, outline=TEAL_KAS)
        d.text((80, 124), "⚙ hardkas.config.ts", fill=TEAL_KAS, font=FONT_MONO_SM)
        d.text((80, 150), "📁 test", fill=TEXT_MAIN, font=FONT_MONO_SM)
        d.text((95, 172), "🧪 payment.test.ts", fill=TEXT_MUTED, font=FONT_MONO_SM)
        d.text((80, 195), "📦 package.json", fill=TEXT_MUTED, font=FONT_MONO_SM)
        
        # Center Editor (x: 261 to W)
        d.rectangle([261, 63, W, H - 24], fill=BG_STAGE)
        
        # Tab bar
        d.rectangle([261, 63, W, 95], fill=(9, 13, 22))
        d.line([261, 95, W, 95], fill=BORDER_COLOR)
        d.rounded_rectangle([270, 68, 440, 95], radius=4, fill=BG_STAGE, outline=BORDER_COLOR)
        d.text((285, 74), "⚙ hardkas.config.ts", fill=TEAL_KAS, font=FONT_MONO_SM)
        
        # Code lines
        lines = [
            (1, "import { defineHardkasConfig } from '@hardkas/sdk';", PURPLE_SYN),
            (2, "", TEXT_MAIN),
            (3, "export default defineHardkasConfig({", BLUE_SYN),
            (4, "  execution: {", TEXT_MAIN),
            (5, "    default: 'simulator',", AMBER_SYN),
            (6, "    targets: {", TEXT_MAIN),
            (7, "      simulator: { mode: 'simulator', network: 'simulated' },", TEXT_MUTED),
            (8, "      localnet:  { mode: 'localnet',  rpcUrl: 'ws://127.0.0.1:18210' }", TEXT_MUTED),
            (9, "    }", TEXT_MAIN),
            (10, "  },", TEXT_MAIN),
            (11, "  network: { allowPublic: false }, // Proteccion estricta L1", TEAL_KAS),
            (12, "  artifacts: { deterministic: true }", TEXT_MUTED),
            (13, "});", BLUE_SYN),
        ]
        
        ey = 115
        for ln, code, color in lines:
            d.text((280, ey), f"{ln:2d}", fill=TEXT_DIM, font=FONT_MONO_SM)
            d.text((320, ey), code, fill=color, font=FONT_MONO)
            ey += 24
            
        # Terminal at bottom
        d.rectangle([261, 480, W, H - 24], fill=(5, 8, 15))
        d.line([261, 480, W, 480], fill=BORDER_COLOR)
        d.text((280, 490), "TERMINAL · bash", fill=TEXT_DIM, font=FONT_MONO_SM)
        d.text((280, 515), "$ hardkas status", fill=TEXT_MUTED, font=FONT_MONO)
        d.text((280, 540), "Target: simulator · Isolation: active · 0 network calls allowed outside local", fill=TEAL_KAS, font=FONT_MONO_SM)
        
        # Cursor
        draw_cursor(d, 560, 360, "Inspeccionando config")
        draw_subtitle(d, "Paso 2: Se genera hardkas.config.ts con los targets Simulator y Localnet")

    elif t < 15.0:
        # Chapter 3: Tests & @hardkas/sdk Scenario
        draw_ide_frame(d, "kaspa-payment-app / test / payment.test.ts", env_node_ready=False)
        
        # Left Panel (Tests Explorer)
        d.rectangle([46, 63, 260, H - 24], fill=BG_PANEL)
        d.line([260, 63, 260, H - 24], fill=BORDER_COLOR)
        d.text((58, 75), "TEST EXPLORER", fill=TEXT_DIM, font=FONT_MONO_SM)
        d.rounded_rectangle([58, 100, 248, 160], radius=6, fill=TEAL_BG, outline=TEAL_KAS)
        d.text((68, 110), "✓ payment.test.ts", fill=TEAL_KAS, font=FONT_MONO_SM)
        d.text((80, 132), "● scenario('payment flow')", fill=TEXT_MAIN, font=FONT_MONO_SM)
        
        # Center Editor
        d.rectangle([261, 63, W, H - 24], fill=BG_STAGE)
        d.rectangle([261, 63, W, 95], fill=(9, 13, 22))
        d.line([261, 95, W, 95], fill=BORDER_COLOR)
        d.text((285, 74), "🧪 test / payment.test.ts", fill=TEAL_KAS, font=FONT_MONO_SM)
        
        test_lines = [
            (1, "import { scenario, expect } from '@hardkas/testing/scenarios';", PURPLE_SYN),
            (2, "", TEXT_MAIN),
            (3, "scenario('payment flow', async ({ hk }) => {", BLUE_SYN),
            (4, "  const alice = await hk.accounts.resolve('alice');", TEXT_MAIN),
            (5, "  const bob   = await hk.accounts.resolve('bob');", TEXT_MAIN),
            (6, "  // 1. Planificar transferencia en Kaspa L1", TEAL_KAS),
            (7, "  const plan = await hk.tx.plan({ from: alice.name, to: bob.address, amount: '10' });", AMBER_SYN),
            (8, "  // 2. Firmar con clave Schnorr x-only y enviar", TEAL_KAS),
            (9, "  const signed = await hk.tx.sign(plan);", TEXT_MAIN),
            (10, "  const result = await hk.tx.send(signed);", TEXT_MAIN),
            (11, "  expect(result.receipt).toBeDefined();", TEXT_MUTED),
            (12, "  expect(await hk.accounts.balance(bob.address)).toBe(10n * 100000000n);", TEXT_MAIN),
            (13, "});", BLUE_SYN),
        ]
        
        ey = 115
        for ln, code, color in test_lines:
            d.text((280, ey), f"{ln:2d}", fill=TEXT_DIM, font=FONT_MONO_SM)
            d.text((320, ey), code, fill=color, font=FONT_MONO)
            ey += 22
            
        # Console output
        d.rectangle([261, 440, W, H - 24], fill=(5, 8, 15))
        d.line([261, 440, W, 440], fill=BORDER_COLOR)
        d.text((280, 450), "CONSOLE · vitest runner", fill=TEXT_DIM, font=FONT_MONO_SM)
        d.text((280, 475), "$ npx vitest run test/payment.test.ts", fill=TEXT_MUTED, font=FONT_MONO)
        d.text((280, 500), "PASS  test/payment.test.ts > payment flow (1240ms)", fill=TEAL_KAS, font=FONT_MONO_BOLD)
        d.text((280, 525), "✓ TxID: 3f92a1... confirmada · 10 KAS acreditados a Bob · Cambio a Alice", fill=TEXT_MAIN, font=FONT_MONO_SM)
        d.text((280, 550), "Test Files: 1 passed (1) | Tests: 1 passed (1)", fill=TEAL_KAS, font=FONT_MONO_SM)
        
        draw_cursor(d, 640, 505, "Vitest PASS")
        draw_subtitle(d, "Paso 3: Ejecutamos el flujo de pago con el SDK de HardKas y pruebas Vitest")

    elif t < 20.0:
        # Chapter 4: Servers Panel & Node Startup (Fix verification)
        draw_ide_frame(d, "kaspa-payment-app / Servers & Accounts", env_node_ready=True)
        
        # Left Panel (Servers Panel)
        d.rectangle([46, 63, 340, H - 24], fill=BG_PANEL)
        d.line([340, 63, 340, H - 24], fill=BORDER_COLOR)
        
        d.text((58, 75), "SERVERS & LOCALNET", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # rusty-kaspad card
        d.rounded_rectangle([58, 100, 328, 170], radius=6, fill=(11, 15, 25), outline=TEAL_KAS)
        d.ellipse([70, 115, 78, 123], fill=TEAL_KAS)
        d.text((86, 112), "rusty-kaspad (Docker)", fill=(255, 255, 255), font=FONT_UI_BOLD)
        d.text((70, 135), "Port: 127.0.0.1:18210   Network: Simnet", fill=TEXT_MUTED, font=FONT_MONO_SM)
        d.text((70, 150), "Container: hardkas-kaspad-toccata-v2", fill=TEAL_KAS, font=FONT_MONO_SM)
        
        # Accounts Card
        d.text((58, 190), "ACCOUNTS (SIMNET)", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # Alice
        d.rounded_rectangle([58, 210, 328, 275], radius=6, fill=(11, 15, 25), outline=BORDER_COLOR)
        d.text((70, 222), "alice", fill=(255, 255, 255), font=FONT_UI_BOLD)
        d.text((240, 222), "100.00 KAS", fill=TEAL_KAS, font=FONT_MONO_SM)
        d.text((70, 245), "kaspasim:qqlpk9m2qf... (Schnorr ready)", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # Bob
        d.rounded_rectangle([58, 290, 328, 355], radius=6, fill=(11, 15, 25), outline=BORDER_COLOR)
        d.text((70, 302), "bob", fill=(255, 255, 255), font=FONT_UI_BOLD)
        d.text((240, 302), "10.00 KAS", fill=TEAL_KAS, font=FONT_MONO_SM)
        d.text((70, 325), "kaspasim:qryj23zp4... (Recibido)", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # Center Stage: Mining & Node Status
        d.rectangle([341, 63, W, H - 24], fill=BG_STAGE)
        
        # Mining Progress Box
        d.rounded_rectangle([380, 120, W - 60, 220], radius=8, fill=(15, 20, 35), outline=TEAL_KAS)
        d.text((400, 138), "Minando bloques locales en Docker (Maduracion Coinbase)", fill=(255, 255, 255), font=FONT_UI_BOLD)
        d.text((W - 160, 138), "100% LISTO", fill=TEAL_KAS, font=FONT_MONO_BOLD)
        
        # Progress Bar
        d.rounded_rectangle([400, 168, W - 80, 188], radius=6, fill=(5, 8, 15), outline=BORDER_COLOR)
        d.rounded_rectangle([400, 168, W - 80, 188], radius=6, fill=TEAL_KAS)
        
        d.text((400, 196), "DAA Score: 342,116 / 342,116 · Bloques maduros y listos para transacciones", fill=TEXT_MUTED, font=FONT_MONO_SM)
        
        # Fix demonstration note
        d.rounded_rectangle([380, 260, W - 60, 360], radius=8, fill=(11, 15, 25), outline=BORDER_COLOR)
        d.text((400, 278), "Verificacion de UX:", fill=AMBER_SYN, font=FONT_UI_BOLD)
        d.text((400, 305), "• Cuando el nodo esta apagado, las cuentas y saldos en 0 KAS quedan ocultas.", fill=TEXT_MAIN, font=FONT_UI)
        d.text((400, 328), "• Al iniciar el nodo, se conectan los sockets y se cargan los saldos reales de simnet.", fill=TEAL_KAS, font=FONT_UI)
        
        draw_cursor(d, 200, 135, "Node Online")
        draw_subtitle(d, "Paso 4: Verificamos el nodo local rusty-kaspad y la activación de cuentas")

    else:
        # Chapter 5: Visual DAG Lineage Graph
        draw_ide_frame(d, "kaspa-payment-app / Lineage DAG Visualizer", env_node_ready=True)
        
        # Center Visual Graph
        d.rectangle([46, 63, W, H - 24], fill=BG_STAGE)
        
        d.text((70, 80), "VISOR VISUAL DEL GRAFO BLOCKDAG (LINEAGE GRAPH)", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # Box 1: Input UTXO (Alice)
        d.rounded_rectangle([80, 200, 320, 320], radius=8, fill=(15, 23, 42), outline=BLUE_SYN, width=2)
        d.text((100, 215), "INPUT UTXO #0", fill=BLUE_SYN, font=FONT_MONO_SM)
        d.text((100, 240), "Alice (Sender)", fill=(255, 255, 255), font=FONT_UI_BOLD)
        d.text((100, 265), "Valor: 100.00 KAS", fill=TEAL_KAS, font=FONT_MONO)
        d.text((100, 290), "kaspasim:qqlpk9m2qf...", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # Arrow 1
        d.line([325, 260, 435, 260], fill=TEAL_KAS, width=3)
        d.polygon([(435, 254), (445, 260), (435, 266)], fill=TEAL_KAS)
        d.text((345, 240), "Schnorr Sig", fill=TEXT_MUTED, font=FONT_MONO_SM)
        
        # Box 2: Kaspa Transaction Node
        d.rounded_rectangle([450, 180, 770, 340], radius=10, fill=TEAL_BG, outline=TEAL_KAS, width=2)
        d.text((530, 200), "KASPA TRANSACTION", fill=TEAL_KAS, font=FONT_MONO_BOLD)
        d.text((540, 225), "Transfer 10 KAS", fill=(255, 255, 255), font=FONT_UI_TITLE)
        d.text((470, 260), "TxID: tx_3f92a188e404b9c71d20014e", fill=TEXT_MAIN, font=FONT_MONO_SM)
        d.text((470, 285), "Fee: 0.0001 KAS · Consensus: Simnet L1", fill=TEXT_MUTED, font=FONT_MONO_SM)
        d.text((470, 308), "Status: CONFIRMED IN BLOCKDAG", fill=TEAL_KAS, font=FONT_MONO_SM)
        
        # Arrow 2
        d.line([775, 260, 875, 260], fill=TEAL_KAS, width=3)
        d.polygon([(875, 254), (885, 260), (875, 266)], fill=TEAL_KAS)
        d.text((800, 240), "DAG Split", fill=TEXT_MUTED, font=FONT_MONO_SM)
        
        # Box 3: Output 0 (Bob)
        d.rounded_rectangle([890, 160, 1160, 260], radius=8, fill=(15, 23, 42), outline=TEAL_KAS, width=2)
        d.text((910, 175), "OUTPUT #0 (BOB)", fill=TEAL_KAS, font=FONT_MONO_SM)
        d.text((910, 198), "+10.00 KAS", fill=(255, 255, 255), font=FONT_UI_BOLD)
        d.text((910, 225), "kaspasim:qryj23zp4...", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # Box 4: Output 1 (Change to Alice)
        d.rounded_rectangle([890, 280, 1160, 380], radius=8, fill=(15, 23, 42), outline=BORDER_COLOR)
        d.text((910, 295), "OUTPUT #1 (CAMBIO ALICE)", fill=TEXT_MUTED, font=FONT_MONO_SM)
        d.text((910, 318), "89.9999 KAS", fill=TEXT_MAIN, font=FONT_UI_BOLD)
        d.text((910, 345), "Retornado a Alice", fill=TEXT_DIM, font=FONT_MONO_SM)
        
        # Verification box
        d.rounded_rectangle([80, 420, W - 80, 470], radius=6, fill=(11, 15, 25), outline=TEAL_KAS)
        d.text((100, 435), "✓ Ciclo de desarrollo completado: Proyecto creado, probado con el SDK, ejecutado en Simnet y verificado en el BlockDAG.", fill=TEAL_KAS, font=FONT_UI_BOLD)
        
        draw_cursor(d, 610, 270, "Tx Confirmada")
        draw_subtitle(d, "Paso 5: Inspección visual del flujo UTXO y confirmación en el grafo de Kaspa")

    return img

def main():
    print(f"Iniciando generacion de video MP4: {TOTAL_FRAMES} frames ({TOTAL_SECS}s @ {FPS}fps)...")
    
    cmd = [
        FFMPEG, "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{W}x{H}",
        "-pix_fmt", "rgb24",
        "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        OUT_WORKSPACE
    ]
    
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    for frame_idx in range(TOTAL_FRAMES):
        t = frame_idx / FPS
        img = render_frame(t)
        proc.stdin.write(img.tobytes())
        if frame_idx % 50 == 0:
            print(f"Progreso: {frame_idx}/{TOTAL_FRAMES} frames ({(frame_idx/TOTAL_FRAMES)*100:.0f}%)...")
            
    proc.stdin.close()
    proc.wait()
    
    # Copy to artifact folder
    import shutil
    shutil.copyfile(OUT_WORKSPACE, OUT_ARTIFACT)
    
    size_mb = os.path.getsize(OUT_WORKSPACE) / (1024 * 1024)
    print(f"Video MP4 generado exitosamente!")
    print(f"Ruta Workspace: {OUT_WORKSPACE} ({size_mb:.2f} MB)")
    print(f"Ruta Artifact: {OUT_ARTIFACT}")

if __name__ == "__main__":
    main()
