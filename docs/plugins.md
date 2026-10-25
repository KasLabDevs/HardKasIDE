# HardKas IDE plugins

Every feature of the IDE is a plugin on a small engine (`apps/ide/src/engine/engine.ts`), in the spirit of Remix's plugin engine. Plugins have a **profile** (`name`, `displayName`, `location`, `methods`, `events`) and talk to each other only through the engine:

```ts
await this.call("fileManager", "readFile", "contracts/escrow.sil");
this.on("silverCompiler", "compilationFinished", (result) => { … });
this.emit("myEvent", payload);
```

Built-in plugins live in `apps/ide/src/plugins`. **External plugins** are web pages loaded in a sandboxed iframe and use the same vocabulary over `postMessage`. The Plugins view (puzzle icon) lists, activates, deactivates, installs and uninstalls them.

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

3. Install it from the Plugins view: paste the manifest URL, fill the manual form, or publish it to npm with the manifest under a `"hardkasPlugin"` key in `package.json` and install it by package name (the ide-server runs `npm install` under `.hardkas/ide/plugins` and serves the files).

## Permissions

A call from an external plugin to `plugin.method` is allowed when:

- it is harmless (`console.log/info/warn/error/logJson`, `fileManager.getCurrentFile`), or
- the manifest declares it in `permissions` (`"fileManager.readFile"` or a wildcard `"fileManager.*"`), or
- the user granted it when asked. The answer is remembered per plugin in the browser and shown in the plugin's details; uninstalling clears it.

Messages are accepted only from the plugin's own iframe window, and replies go to the iframe's origin.

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
