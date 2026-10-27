import { GitFork } from "lucide-react";
import { Plugin } from "@/engine/engine";
import { useIde } from "@/store/ide";
import { CovenantView } from "@/views/CovenantView";

/**
 * Visual UTXO & Covenant Flow: interactive lifecycle graph of SilverScript contracts,
 * spending entrypoints, opcode sequences, and settlement output transactions.
 */
export class CovenantPlugin extends Plugin {
  view = CovenantView;

  constructor() {
    super({
      name: "covenant",
      displayName: "Covenant Graph",
      description: "Visual UTXO and covenant execution flow inspector",
      location: "mainPanel",
      icon: GitFork,
      order: 48,
      methods: ["open"],
      events: []
    });
  }

  open(): void {
    useIde.getState().openView(this.profile.name, "Covenant Graph");
  }
}
