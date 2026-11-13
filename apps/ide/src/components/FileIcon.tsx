import clsx from "clsx";

interface FileIconProps {
  /** File name or relative path (e.g. "App.tsx", "contracts/Vault.sil", "tsconfig.json"). */
  name: string;
  size?: number;
  className?: string;
}

/**
 * Renders a Seti / VS Code-style file icon for each file extension and special filename,
 * plus dedicated Kaspa / SilverScript icons for `.sil` and `hardkas.config.*`.
 */
export function FileIcon({ name, size = 15, className }: FileIconProps) {
  const base = (name.split(/[/\\]/).pop() ?? name).toLowerCase();

  // 1. SilverScript contracts (.sil)
  if (base.endsWith(".sil")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <polygon points="8,1.2 14,4.6 14,11.4 8,14.8 2,11.4 2,4.6" fill="#49eacb" fillOpacity="0.18" stroke="#49eacb" strokeWidth="1.2" />
        <path
          d="M9.6 5.5C9.6 4.95 9.0 4.6 8.05 4.6C7.1 4.6 6.5 4.98 6.5 5.55C6.5 6.18 7.15 6.42 8.2 6.72C9.45 7.08 10.1 7.55 10.1 8.58C10.1 9.65 9.2 10.3 7.95 10.3C6.7 10.3 5.85 9.7 5.75 8.75"
          stroke="#49eacb"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // 2. HardKas config (hardkas.config.*)
  if (base.startsWith("hardkas.config.")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="#49eacb" fillOpacity="0.16" stroke="#49eacb" strokeWidth="1.2" />
        <path d="M5 4.5V11.5M5 8H8.2M8.2 4.5L11.2 8L8.2 11.5" stroke="#49eacb" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // 3. Vite config (vite.config.* / vitest.config.*) — yellow lightning bolt
  if (base.startsWith("vite.config.") || base.startsWith("vitest.config.")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path d="M9.2 1.5L3.5 8.8H7.6L6.8 14.5L12.5 7.2H8.4L9.2 1.5Z" fill="#ffd028" />
      </svg>
    );
  }

  // 4. React (.tsx, .jsx) — cyan React atom
  if (base.endsWith(".tsx") || base.endsWith(".jsx")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <circle cx="8" cy="8" r="1.35" fill="#519aba" />
        <ellipse cx="8" cy="8" rx="6.4" ry="2.45" stroke="#519aba" strokeWidth="1.05" />
        <ellipse cx="8" cy="8" rx="6.4" ry="2.45" transform="rotate(60 8 8)" stroke="#519aba" strokeWidth="1.05" />
        <ellipse cx="8" cy="8" rx="6.4" ry="2.45" transform="rotate(120 8 8)" stroke="#519aba" strokeWidth="1.05" />
      </svg>
    );
  }

  // 5. TypeScript: tsconfig.json or .ts / .mts / .cts — blue TS badge
  if (base === "tsconfig.json" || base.endsWith(".ts") || base.endsWith(".mts") || base.endsWith(".cts")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <rect x="1.5" y="2" width="13" height="12" rx="1.8" fill="#519aba" />
        <path
          d="M4.2 6.2H8.2M6.2 6.2V11.6M12.3 6.8C12.0 6.35 11.45 6.15 10.75 6.15C9.85 6.15 9.25 6.58 9.25 7.25C9.25 7.9 9.75 8.2 10.75 8.5C11.75 8.8 12.35 9.18 12.35 10.02C12.35 10.95 11.6 11.55 10.55 11.55C9.65 11.55 9.05 11.2 8.75 10.65"
          stroke="#181818"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // 6. JavaScript (.js, .mjs, .cjs) — yellow JS lettering
  if (base.endsWith(".js") || base.endsWith(".mjs") || base.endsWith(".cjs")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path
          d="M6.4 4.5V10.1C6.4 11.15 5.75 11.75 4.75 11.75C3.95 11.75 3.4 11.35 3.15 10.7"
          stroke="#cbcb41"
          strokeWidth="1.55"
          strokeLinecap="round"
        />
        <path
          d="M12.7 5.5C12.35 4.85 11.7 4.55 10.85 4.55C9.75 4.55 9.05 5.1 9.05 5.92C9.05 6.72 9.65 7.1 10.85 7.48C12.05 7.85 12.8 8.32 12.8 9.4C12.8 10.62 11.9 11.35 10.6 11.35C9.5 11.35 8.75 10.88 8.4 10.15"
          stroke="#cbcb41"
          strokeWidth="1.55"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // 7. JSON (.json, .jsonc) — yellow curly braces {}
  if (base.endsWith(".json") || base.endsWith(".jsonc")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path
          d="M6.1 3.2C4.9 3.2 4.4 3.7 4.4 4.7V6.4C4.4 7.2 3.9 7.7 3.0 8.0C3.9 8.3 4.4 8.8 4.4 9.6V11.3C4.4 12.3 4.9 12.8 6.1 12.8"
          stroke="#cbcb41"
          strokeWidth="1.45"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.9 3.2C11.1 3.2 11.6 3.7 11.6 4.7V6.4C11.6 7.2 12.1 7.7 13.0 8.0C12.1 8.3 11.6 8.8 11.6 9.6V11.3C11.6 12.3 11.1 12.8 9.9 12.8"
          stroke="#cbcb41"
          strokeWidth="1.45"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // 8. CSS / SCSS / LESS — blue # hash
  if (base.endsWith(".css") || base.endsWith(".scss") || base.endsWith(".less")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path
          d="M6.3 2.8L4.9 13.2M11.1 2.8L9.7 13.2M3.2 6.2H13.1M2.9 9.8H12.8"
          stroke="#519aba"
          strokeWidth="1.45"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // 9. HTML (.html, .htm) — orange <> brackets
  if (base.endsWith(".html") || base.endsWith(".htm")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path
          d="M6.2 4.5L2.5 8L6.2 11.5M9.8 4.5L13.5 8L9.8 11.5"
          stroke="#e37933"
          strokeWidth="1.55"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // 10. Markdown (.md, .mdx) — blue down arrow with M/bar
  if (base.endsWith(".md") || base.endsWith(".mdx")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path
          d="M8 2.5V10.5M8 10.5L4.8 7.3M8 10.5L11.2 7.3M3.5 13H12.5"
          stroke="#519aba"
          strokeWidth="1.55"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // 11. YAML (.yaml, .yml) — purple exclamation mark !
  if (base.endsWith(".yaml") || base.endsWith(".yml")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path d="M8 2.6V9.6" stroke="#a074c4" strokeWidth="2" strokeLinecap="round" />
        <circle cx="8" cy="12.7" r="1.15" fill="#a074c4" />
      </svg>
    );
  }

  // 12. Git (.gitignore, .gitattributes, .gitmodules) — red-orange Git diamond
  if (base.startsWith(".git")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path
          d="M8.7 1.8L14.2 7.3C14.6 7.7 14.6 8.3 14.2 8.7L8.7 14.2C8.3 14.6 7.7 14.6 7.3 14.2L1.8 8.7C1.4 8.3 1.4 7.7 1.8 7.3L7.3 1.8C7.7 1.4 8.3 1.4 8.7 1.8Z"
          stroke="#e34c26"
          strokeWidth="1.3"
        />
        <path d="M6.2 4.2L9.8 7.8M8 6V10.2" stroke="#e34c26" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="8" cy="6" r="1.1" fill="#e34c26" />
        <circle cx="9.8" cy="7.8" r="1.1" fill="#e34c26" />
        <circle cx="8" cy="10.2" r="1.1" fill="#e34c26" />
      </svg>
    );
  }

  // 13. SVG / Images (.svg, .png, .jpg, .jpeg, .webp, .gif, .ico) — purple vector shapes
  if (/\.(svg|png|jpe?g|webp|gif|ico)$/i.test(base)) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <circle cx="6.2" cy="6.2" r="3.4" fill="#a074c4" fillOpacity="0.85" />
        <rect x="6.8" y="6.8" width="6.2" height="6.2" rx="1.2" fill="#a074c4" stroke="#181818" strokeWidth="0.8" />
      </svg>
    );
  }

  // 14. Vue (.vue) — green V
  if (base.endsWith(".vue")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path d="M2 3H5.2L8 7.8L10.8 3H14L8 13.5L2 3Z" fill="#41b883" />
        <path d="M5.2 3H6.9L8 5L9.1 3H10.8L8 8L5.2 3Z" fill="#35495e" />
      </svg>
    );
  }

  // 15. Svelte (.svelte) — orange S
  if (base.endsWith(".svelte")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <path
          d="M10.8 3.2C9.5 2.2 7.5 2.4 6.2 3.5L4.4 5.0C3.4 5.9 3.2 7.3 4.0 8.4C4.4 8.9 5.0 9.2 5.6 9.3L5.2 9.7C4.2 10.6 4.4 12.1 5.5 12.9C6.8 13.8 8.8 13.6 10.1 12.5L11.9 11.0C12.9 10.1 13.1 8.7 12.3 7.6C11.9 7.1 11.3 6.8 10.7 6.7L11.1 6.3C12.1 5.4 11.9 3.9 10.8 3.2Z"
          stroke="#ff3e00"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // 16. SQL / SQLite (.sql, .db, .sqlite) — blue database cylinders
  if (base.endsWith(".sql") || base.endsWith(".db") || base.endsWith(".sqlite")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <ellipse cx="8" cy="4" rx="4.8" ry="1.8" stroke="#519aba" strokeWidth="1.3" />
        <path d="M3.2 4V12C3.2 13 5.35 13.8 8 13.8C10.65 13.8 12.8 13 12.8 12V4" stroke="#519aba" strokeWidth="1.3" />
        <path d="M3.2 8C3.2 9 5.35 9.8 8 9.8C10.65 9.8 12.8 9 12.8 8" stroke="#519aba" strokeWidth="1.3" />
      </svg>
    );
  }

  // 17. Shell scripts (.sh, .bash, .zsh, .ps1, .bat, .cmd) — teal terminal prompt
  if (/\.(sh|bash|zsh|ps1|bat|cmd)$/i.test(base)) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.6" stroke="#8d969e" strokeWidth="1.2" />
        <path d="M4.2 6L6.6 8L4.2 10M7.8 10H11.5" stroke="#49eacb" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // 18. Rust (.rs) & TOML (.toml) — warm amber gear/config
  if (base.endsWith(".rs") || base.endsWith(".toml")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <circle cx="8" cy="8" r="2.6" stroke="#e37933" strokeWidth="1.35" />
        <path d="M8 2V4M8 12V14M2 8H4M12 8H14M3.8 3.8L5.2 5.2M10.8 10.8L12.2 12.2M12.2 3.8L10.8 5.2M5.2 10.8L3.8 12.2" stroke="#e37933" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    );
  }

  // 19. Docker (dockerfile, docker-compose.*) — Docker container whale blocks
  if (base === "dockerfile" || base.startsWith("dockerfile.") || base.startsWith("docker-compose.")) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <rect x="3" y="6.5" width="2.5" height="2" fill="#519aba" />
        <rect x="6.2" y="6.5" width="2.5" height="2" fill="#519aba" />
        <rect x="9.4" y="6.5" width="2.5" height="2" fill="#519aba" />
        <rect x="6.2" y="3.8" width="2.5" height="2" fill="#519aba" />
        <path d="M1.8 9.5H13.8C13.4 12.1 11.2 13.5 7.8 13.5C4.2 13.5 2.2 11.8 1.8 9.5Z" fill="#519aba" />
      </svg>
    );
  }

  // 20. Lock files (.lock) — padlock
  if (base.endsWith(".lock") || base === "package-lock.json") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" stroke="#cbcb41" strokeWidth="1.3" />
        <path d="M5.5 7V5.2C5.5 3.7 6.6 2.6 8 2.6C9.4 2.6 10.5 3.7 10.5 5.2V7" stroke="#cbcb41" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  // 21. Env / Dotfiles (.env, .env.*, .npmrc, .nvmrc)
  if (base.startsWith(".env") || base === ".npmrc" || base === ".nvmrc") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
        <circle cx="8" cy="8" r="2.3" stroke="#cbcb41" strokeWidth="1.3" />
        <path d="M8 2.2V4.1M8 11.9V13.8M2.2 8H4.1M11.9 8H13.8M3.9 3.9L5.2 5.2M10.8 10.8L12.1 12.1M12.1 3.9L10.8 5.2M5.2 10.8L3.9 12.1" stroke="#cbcb41" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  // 22. Default text / file icon (lines, matching texts.txt in screenshot)
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={clsx("shrink-0", className)} aria-hidden="true">
      <path
        d="M3.5 3.8H12.5M3.5 6.6H10.2M3.5 9.4H12.5M3.5 12.2H8.8"
        stroke="#8d969e"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
