# AutoFlow for Windows (Tauri 2)

Native shell around the AutoFlow web app. Flows run in the Rust engine (`crates/engine`), so they keep
running while the window is hidden in the tray. **Halt**: Ctrl+Alt+Esc (default) or tray → *Halt all runs*.

## Develop / build (Windows)

```powershell
pnpm install
pnpm --filter @autoflow/core build
pnpm --filter @autoflow/web build              # produces apps/web/dist (the app entry is index.html)
powershell -ExecutionPolicy Bypass -File scripts\windows\sign.ps1 -Install -SkipDlib   # once, elevated
cd apps/desktop
npx @tauri-apps/cli@2.12.3 dev                 # devUrl http://localhost:5173 (runs the web dev server)
npx @tauri-apps/cli@2.12.3 build               # NSIS + MSI in target/release/bundle
```

`bundle.windows.signCommand` calls `C:\afsign\sign.ps1`; without `AZURE_SIGN_PROFILE` it skips signing.
Signed releases are built by `.github/workflows/windows.yml` — see [docs/WINDOWS_SIGNING.md](../../docs/WINDOWS_SIGNING.md)
(copy `scripts/windows/setup-azure-signing.ps1` to your Downloads folder and run it from there once).

## Bridge (for the web app)

- `withGlobalTauri` is on: `window.__TAURI__.core.invoke(name, args)` and `window.__TAURI__.event.listen("autoflow://event", …)`.
- Every command of `BridgeCommands` in `packages/core/src/bridge.ts` exists with the same name; args use the bridge's
  camelCase keys, e.g. `invoke("run_start", { flow, inputs, approvedRisk, approvedScreenChange, dryRun })`.
  Errors reject the promise with a message string.
- `run_start` with `dryRun: true` runs against a virtual screen (nothing is typed or clicked).
- Hotkey-triggered starts (`triggers_sync`) are run natively; the `hotkey` event with `action: "start"` is a
  notification — do not start the flow again. Risky hotkey runs ask for approval in a native dialog; schedules and
  app/device events never approve risky steps (the run fails with "risky steps were not approved").
- `findImage` / image targets read `%APPDATA%\com.projectteamforyou.autoflow\images\<ref>.png`.
- CSP allows network access only to the Railway API (`*.up.railway.app`), OpenAI, Anthropic and local
  Ollama/LM Studio; add other hosts in `src-tauri/tauri.conf.json`.
