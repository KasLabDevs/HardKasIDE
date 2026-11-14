import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * IDE-wide settings kept by the server in ~/.hardkas-ide/settings.json (not per project, not in the browser, so a
 * page cannot turn them on behind the user's back: only the IDE page may call the setter, and never an agent).
 *
 * thirdPartyExtensions: Open VSX extensions and plugins from npm or a URL run code the HardKas team never saw.
 * Off by default; the bundled example plugins are part of the IDE and work either way.
 */
export interface IdeSettings {
  thirdPartyExtensions: boolean;
  /** SHA-256 of the local cli-debugger build the user approved for the SilverScript debugger (null: none). */
  approvedSilverRunnerSha256: string | null;
}

const DEFAULTS: IdeSettings = { thirdPartyExtensions: false, approvedSilverRunnerSha256: null };

function settingsFile(): string {
  return path.join(os.homedir(), ".hardkas-ide", "settings.json");
}

export async function readIdeSettings(): Promise<IdeSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsFile(), "utf8")) as Partial<IdeSettings> | null;
    return {
      thirdPartyExtensions: raw?.thirdPartyExtensions === true,
      approvedSilverRunnerSha256: typeof raw?.approvedSilverRunnerSha256 === "string" && /^[0-9a-f]{64}$/.test(raw.approvedSilverRunnerSha256) ? raw.approvedSilverRunnerSha256 : null
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeIdeSettings(patch: Partial<IdeSettings>): Promise<IdeSettings> {
  const next: IdeSettings = { ...(await readIdeSettings()) };
  if (typeof patch.thirdPartyExtensions === "boolean") next.thirdPartyExtensions = patch.thirdPartyExtensions;
  if (patch.approvedSilverRunnerSha256 === null || (typeof patch.approvedSilverRunnerSha256 === "string" && /^[0-9a-f]{64}$/.test(patch.approvedSilverRunnerSha256))) {
    next.approvedSilverRunnerSha256 = patch.approvedSilverRunnerSha256;
  }
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function thirdPartyExtensionsEnabled(): Promise<boolean> {
  return (await readIdeSettings()).thirdPartyExtensions;
}
