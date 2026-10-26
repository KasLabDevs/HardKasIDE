import { Check, Copy, Link2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useEnv } from "@/store/env";
import { useIde } from "@/store/ide";

/** Minimal surface of the KasWare injected provider (window.kasware). */
interface KaswareProvider {
  requestAccounts(): Promise<string[]>;
  getAccounts?(): Promise<string[]>;
  getNetwork?(): Promise<string>;
  switchNetwork?(network: string): Promise<string>;
  getBalance?(): Promise<{ confirmed: number; unconfirmed: number; total: number }>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    kasware?: KaswareProvider;
  }
}

/**
 * What a browser wallet (KasWare) needs to talk to this node, plus a Connect
 * button that asks the extension to authorise this site. The extension only
 * exists in a real browser profile, so open the IDE in Chrome with KasWare installed.
 */
export function WalletCard() {
  const node = useEnv((s) => s.node);
  const target = useIde((s) => s.target);
  const [provider, setProvider] = useState<KaswareProvider | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [network, setNetwork] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const check = () => setProvider(window.kasware ?? null);
    check();
    const t = setTimeout(check, 1500); // extensions inject after load
    return () => clearTimeout(t);
  }, []);

  const networkName = node?.network ?? (target === "localnet" ? "simnet" : target === "rpc" ? "testnet-10" : "simnet");
  const rows: Array<{ k: string; v: string }> = [
    { k: "network", v: networkName },
    { k: "network id", v: `kaspa-${networkName}` },
    { k: "wRPC (json)", v: node?.rpcUrl ?? "ws://127.0.0.1:18210" },
    { k: "wRPC (borsh)", v: `ws://127.0.0.1:${node?.ports?.borshRpc ?? 17210}` },
    { k: "gRPC", v: `127.0.0.1:${node?.ports?.rpc ?? 16210}` },
    { k: "address prefix", v: networkName === "simnet" ? "kaspasim:" : networkName === "devnet" ? "kaspadev:" : "kaspatest:" }
  ];

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setMsg(`Copied ${key}`);
    setTimeout(() => {
      setCopiedKey((k) => (k === key ? null : k));
      setMsg(null);
    }, 1500);
  };

  const connect = async () => {
    if (!provider) return;
    try {
      const accs = await provider.requestAccounts();
      setAccounts(accs);
      const net = provider.getNetwork ? await provider.getNetwork() : null;
      setNetwork(net);
      setMsg(`connected: ${accs.length} account(s)${net ? ` on ${net}` : ""}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const switchNet = async () => {
    if (!provider?.switchNetwork) return;
    try {
      const net = await provider.switchNetwork(`kaspa_${networkName}`);
      setNetwork(net);
      setMsg(`switched to ${net}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="border-b border-border">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="label mb-0 flex items-center gap-2">
          <Wallet size={12} /> Wallet (KasWare)
        </span>
        <span className={provider ? "text-ok text-[10px]" : "text-fg-muted text-[10px]"}>{provider ? "extension detected" : "not detected"}</span>
      </div>
      <div className="px-3 pb-3 space-y-2">
        <div className="rounded border border-border bg-bg-elev p-2 space-y-1">
          <div className="text-fg-muted">Import this node in KasWare → Settings → Network → Custom RPC:</div>
          {rows.map((r) => (
            <div key={r.k} className="flex items-center gap-2 min-w-0">
              <span className="w-24 shrink-0 text-fg-muted">{r.k}</span>
              <span className="font-mono text-[11px] truncate flex-1" title={r.v}>
                {r.v}
              </span>
              <button
                type="button"
                onClick={() => void copy(r.k, r.v)}
                className="p-0.5 rounded text-fg-muted hover:text-accent cursor-pointer shrink-0"
                title={`Copy ${r.k}`}
                aria-label={`Copy ${r.k}`}
              >
                {copiedKey === r.k ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
              </button>
            </div>
          ))}
          <div className="text-[10px] text-fg-muted pt-1">
            The node publishes its ports on 127.0.0.1 only, so the wallet must run on this machine. Fund a wallet address with <code>hardkas localnet fund &lt;account&gt;</code> after importing its key as an account, or send to it from alice in Deploy &amp; Run.
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1 justify-center" disabled={!provider} onClick={() => void connect()} title={provider ? "kasware.requestAccounts()" : "Open the IDE in Chrome with the KasWare extension to connect"}>
            <Link2 size={12} /> {accounts.length ? "Connected" : "Connect KasWare"}
          </button>
          <button type="button" className="btn-ghost flex-1 justify-center" disabled={!provider?.switchNetwork} onClick={() => void switchNet()} title={`kasware.switchNetwork("kaspa_${networkName}")`}>
            Switch to {networkName}
          </button>
        </div>
        {accounts.length > 0 && (
          <div className="font-mono text-[10px] break-all text-fg">
            {accounts[0]}
            {network && <span className="text-fg-muted"> · {network}</span>}
          </div>
        )}
        {!provider && <div className="text-[10px] text-fg-muted">No <code>window.kasware</code> here. Open http://localhost:5173 in Chrome with KasWare installed; the IDE will detect it and let you authorise this site.</div>}
        {msg && <div role="status" aria-live="polite" className="text-[10px] text-accent">{msg}</div>}
      </div>
    </section>
  );
}
