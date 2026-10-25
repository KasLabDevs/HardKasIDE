import { Files, Package, Play, Settings } from "lucide-react";
import { Plugin } from "@/engine/engine";
import { ArtifactsPanel } from "@/panels/ArtifactsPanel";
import { FilesPanel } from "@/panels/FilesPanel";
import { RunPanel } from "@/panels/RunPanel";
import { SettingsPanel } from "@/panels/SettingsPanel";
import type { TerminalPlugin } from "./terminal";

/** File explorer view (the logic lives in fileManager). */
export class FilesPlugin extends Plugin {
  view = FilesPanel;
  constructor() {
    super({ name: "files", displayName: "Explorer", location: "sidePanel", icon: Files, order: 10 });
  }
}

/**
 * Deploy & Run equivalent: pick an execution target, plan → sign → send a
 * transaction, and later call contract entries. Backed by `hardkas tx ... --json`.
 */
export class RunPlugin extends Plugin {
  view = RunPanel;
  constructor() {
    super({
      name: "deployRun",
      displayName: "Deploy & Run",
      location: "sidePanel",
      icon: Play,
      order: 30,
      methods: ["plan", "sign", "send", "localnetStatus", "localnetFund", "accounts"],
      events: ["transactionExecuted"]
    });
  }

  private terminal(): TerminalPlugin {
    return this.engine.get<TerminalPlugin>("terminal");
  }

  async accounts() {
    return this.terminal().runHardkas(["accounts", "list", "--json"], { quiet: true });
  }

  async plan(input: { from: string; to: string; amount: string }) {
    return this.terminal().runHardkas(["tx", "plan", "--from", input.from, "--to", input.to, "--amount", input.amount, "--json"]);
  }

  async sign(planRef: string, account: string) {
    return this.terminal().runHardkas(["tx", "sign", planRef, "--account", account, "--json"]);
  }

  async send(signedRef: string) {
    const result = await this.terminal().runHardkas(["tx", "send", signedRef, "--json"]);
    this.emit("transactionExecuted", result);
    return result;
  }

  async localnetStatus() {
    return this.terminal().runHardkas(["localnet", "status", "--json"], { quiet: true });
  }

  async localnetFund(account: string, amount: string) {
    return this.terminal().runHardkas(["localnet", "fund", account, "--amount", amount, "--json"]);
  }
}

export class ArtifactsPlugin extends Plugin {
  view = ArtifactsPanel;
  constructor() {
    super({ name: "artifacts", displayName: "Artifacts", location: "sidePanel", icon: Package, order: 40 });
  }
}

export class SettingsPlugin extends Plugin {
  view = SettingsPanel;
  constructor() {
    super({ name: "settings", displayName: "Settings", location: "sidePanel", icon: Settings, order: 90 });
  }
}
