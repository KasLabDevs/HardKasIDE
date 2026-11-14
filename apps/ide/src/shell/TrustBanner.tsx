import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { api } from "@/api/client";
import { useIde } from "@/store/ide";

/**
 * Restricted mode: a folder the user has not trusted yet can be read and edited, but runs no CLI, npm scripts,
 * tests, debugger or agent (the server refuses with UNTRUSTED_WORKSPACE). One click trusts it for good.
 */
export function TrustBanner() {
  const workspace = useIde((s) => s.workspace);
  const setWorkspace = useIde((s) => s.setWorkspace);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!workspace?.root || workspace.trusted !== false) return null;

  const trust = async () => {
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await api.workspace.trust());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="flex items-center gap-2 border-b border-warn/50 bg-warn/10 px-3 py-1.5 text-xs">
      <ShieldAlert size={14} className="text-warn shrink-0" />
      <span className="min-w-0 flex-1 text-fg">
        <span className="font-semibold text-warn">Restricted mode.</span> You can read and edit files, but this folder runs no HardKas CLI, npm scripts,
        tests, debugger or agent until you trust it. Trust it only if you know where it came from.
        {error && <span className="block text-error break-words">{error}</span>}
      </span>
      <button type="button" className="btn-primary shrink-0" disabled={busy} onClick={() => void trust()} title={workspace.root}>
        {busy ? "…" : "Trust this folder"}
      </button>
    </div>
  );
}
