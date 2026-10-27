import { GitFork } from "lucide-react";
import { Plugin } from "@/engine/engine";
import { useIde } from "@/store/ide";
import { CovenantView } from "@/views/CovenantView";

/**
 * Covenant graph: the compiled SilverScript contract, its deploy records, its entries and its spend
 * records as one left-to-right flow. Everything drawn comes from HardKas records.
 */
export class CovenantPlugin extends Plugin {
  view = CovenantView;

  constructor() {
    super({
      name: "covenant",
      displayName: "Covenant Graph",
      description: "Deploys, entries and spends of the compiled contract, from its HardKas records",
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
