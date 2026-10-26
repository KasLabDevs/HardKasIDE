import { Files, Package, Settings, Users } from "lucide-react";
import { Plugin } from "@/engine/engine";
import { AccountsPanel } from "@/panels/AccountsPanel";
import { ArtifactsPanel } from "@/panels/ArtifactsPanel";
import { FilesPanel } from "@/panels/FilesPanel";
import { SettingsPanel } from "@/panels/SettingsPanel";

export { RunPlugin } from "./run";

/** File explorer view (the logic lives in fileManager). */
export class FilesPlugin extends Plugin {
  view = FilesPanel;
  constructor() {
    super({ name: "files", displayName: "Explorer", location: "sidePanel", icon: Files, order: 10 });
  }
}

export class ArtifactsPlugin extends Plugin {
  view = ArtifactsPanel;
  constructor() {
    super({ name: "artifacts", displayName: "Artifacts", location: "sidePanel", icon: Package, order: 40 });
  }
}

/** Accounts view: balances, public address and private key (view/copy) of every account. */
export class AccountsPlugin extends Plugin {
  view = AccountsPanel;
  constructor() {
    super({ name: "accounts", displayName: "Accounts", description: "Account balances and keys", location: "sidePanel", icon: Users, order: 16 });
  }
}

export class SettingsPlugin extends Plugin {
  view = SettingsPanel;
  constructor() {
    super({ name: "settings", displayName: "Settings", location: "sidePanel", icon: Settings, order: 90 });
  }
}
