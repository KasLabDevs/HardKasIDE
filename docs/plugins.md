# HardKas IDE plugins

Every feature of the IDE is a plugin on a small engine (`apps/ide/src/engine/engine.ts`), built around profiles and a message bus. Plugins have a **profile** (`name`, `displayName`, `location`, `methods`, `events`) and talk to each other only through the engine:

```ts
await this.call("fileManager", "readFile", "contracts/escrow.sil");
this.on("silverCompiler", "compilationFinished", (result) => { … });
this.emit("myEvent", payload);
```

Built-in plugins live in `apps/ide/src/plugins`. **External plugins** are web pages loaded in a sandboxed iframe and use the same vocabulary over `postMessage`. The Plugins view (puzzle icon) lists, activates, deactivates, installs and uninstalls them.

## Third-party extensions are off by default

Plugins from npm or a URL, and Open VSX extensions (themes, grammars, snippets), are code nobody at HardKas has reviewed. They stay off until you turn on **Third-party extensions** at the top of the Plugins view (the IDE reloads). While off, the server refuses to install, search or serve them (`EXTENSIONS_OFF`), the Open VSX search tab is hidden, and installed ones are not loaded. The built-in views and the bundled example plugins (`examples/plugins`) work either way. The switch is kept by the server in `~/.hardkas-ide/settings.json`; an AI agent cannot change it.

## Writing an external plugin

1. Make a web page. Copy the tiny client from `examples/plugins/hello/index.html` (about 30 lines): it gives you `hardkas.call(plugin, method, ...args)`, `hardkas.on(plugin, event, fn)`, `hardkas.emit(event, ...args)` and `hardkas.expose(name, fn)` for methods other plugins may call on yours.
2. Publish a manifest next to it, `hardkas-plugin.json`:

```json
{
  "name": "my-plugin",
  "displayName": "My plugin",
  "description": "What it does",
  "version": "0.1.0",
  "url": "index.html",
  "location": "sidePanel",
  "methods": ["greet"],
  "events": ["greeted"],
  "permissions": ["fileManager.readFile", "console.*"]
}
```

3. Turn on third-party extensions, then install it from the Plugins view: paste the manifest URL, fill the manual form, or publish it to npm with the manifest under a `"hardkasPlugin"` key in `package.json` and install it by package name (the ide-server runs `npm install --ignore-scripts` under `.hardkas/ide/plugins`, so the package's install scripts never run, and serves the files; this needs a trusted folder).

A manifest URL is fetched by the ide-server from public hosts only: every redirect is checked again, and a name that resolves to this machine or a private network is refused.

## Where a plugin runs

Plugin files, VS Code extension files and the workspace's `dapp/` are served with a sandbox Content-Security-Policy, so their pages run on an opaque origin. They cannot call the IDE server's API directly (it refuses `Origin: null` and other pages); everything goes through the message bridge below and its permission checks.

## Permissions

A call from an external plugin to `plugin.method` is allowed when:

- it is harmless (`console.log/info/warn/error/logJson`, `fileManager.getCurrentFile`), or
- the manifest declares it in `permissions` (`"fileManager.readFile"` or a wildcard `"fileManager.*"`), or
- the user granted it when asked. The answer is remembered per plugin in the browser and shown in the plugin's details; uninstalling clears it.

Some calls are refused to external plugins whatever the manifest says: `accounts`, `assistant`, `pluginManager`, reading private keys through `environment`, and `fileManager` calls that name `accounts.real.json` or the dev-server token.

Messages are accepted only from the plugin's own iframe window, and replies are posted to that same window (its origin is opaque, so they are sent with target `"*"`).

## Messages (for other languages or frameworks)

| direction | message |
| --- | --- |
| plugin → IDE | `{ type: "hardkas:hello" }` once loaded |
| IDE → plugin | `{ type: "hardkas:ready", name, profile }` |
| plugin → IDE | `{ type: "hardkas:call", id, plugin, method, args }` |
| IDE → plugin | `{ type: "hardkas:response", id, ok, result \| error }` |
| plugin → IDE | `{ type: "hardkas:on", plugin, event }` then `{ type: "hardkas:event", plugin, event, args }` arrive |
| plugin → IDE | `{ type: "hardkas:emit", event, args }` |
| IDE → plugin | `{ type: "hardkas:invoke", id, method, args }` when another plugin calls one of yours; answer with `hardkas:response` |

## Useful built-in methods

| plugin | methods |
| --- | --- |
| `fileManager` | `readFile(path)`, `writeFile(path, content)`, `open(path)`, `getCurrentFile()`, `refresh()`, `createFile`, `mkdir`, `remove`, `rename` |
| `editor` | `addErrorMarker(diagnostics, owner)`, `clearErrorMarkers(owner)`, `gotoLine(line)` |
| `silverCompiler` | `compile(path, {args})`, `compileCurrent()`, `getLastResult()` |
| `silverContracts` | `deploy({compileRecordPath, from, amountKas})`, `spend({deploy, entry, to, args})`, `refreshDeployments()` |
| `deployRun` | `accounts()`, `plan({from,to,amount,target})`, `sign(planPath, account, target)`, `send(signedPath, target)`, `txStatus(txId, network)` |
| `environment` | `refresh()`, `startNode()`, `stopNode()`, `restartNode()`, `createAccount(name)`, `fund(name, kas)` |
| `console` | `log/info/warn/error(text)`, `logJson(title, data)`, `runHardkas(args)` |
| `lineage`, `tests` | `open()`, `refresh()` / `run()`, `runFile(path)` |

Events worth subscribing to: `fileManager.currentFileChanged`, `fileManager.fileSaved`, `silverCompiler.compilationFinished`, `deployRun.transactionExecuted`, `silverContracts.deployed`, `silverContracts.spent`, `environment.nodeChanged`, `tests.runFinished`.
