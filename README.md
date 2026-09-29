# dsh-plugin-ui-zoom

Interface zoom for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
client: **Ctrl+=** to zoom in, **Ctrl+-** to zoom out, **Ctrl+0** back to 100%.

English | [中文](README.zh.md)

![CI](https://github.com/jiangshirong/dsh-plugin-ui-zoom/actions/workflows/ci.yml/badge.svg)

## Why this exists

The Harness desktop shell renders into a sandboxed renderer
(`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`), and its
preload does not expose Electron's `webFrame` zoom API. Nothing in the shipped
composition binds an interface-zoom gesture either, so the whole UI renders at a
fixed scale with no way to change it.

This plugin adds that gesture. It is a **client-half plugin**: the package root
is an inert Host row (a Loader entry needs one), and the browser half that the
module table serves does the work.

## Install

### 1. Put the package where the profile can resolve it

Run this in the profile directory (`$DSH_HOME/profiles/<profile>`, for the
desktop shell that is `~/.dsh/profiles/desktop`):

```sh
dsh plugin --profile desktop add github:jiangshirong/dsh-plugin-ui-zoom
```

`dsh plugin` forwards its arguments to pnpm inside the profile, so any pnpm spec
works — a git host, a tarball URL, or a local path while developing:

```sh
# while developing, from a checkout of this repository
dsh plugin --profile desktop add file:/absolute/path/to/dsh-plugin-ui-zoom
```

<details>
<summary>Manual equivalent</summary>

The Loader resolves a row's package from `<profile>/node_modules`, so a
directory copy works just as well:

```sh
cd ~/.dsh/profiles/desktop
mkdir -p node_modules
cp -r /path/to/dsh-plugin-ui-zoom node_modules/dsh-plugin-ui-zoom
```

</details>

### 2. Mount the row

Add this to the profile's `cordis.patch.yml`:

```yaml
# Interface zoom (Ctrl+= / Ctrl+- / Ctrl+0).
- insert:
    - id: ui-zoom
      name: dsh-plugin-ui-zoom
```

The `insert` wrapper is required. A patch row that merely names an `id` and a
`name` overrides an *existing* entry; it is silently discarded when no such
entry exists, so a new row must be inserted explicitly.

### 3. Load it

The plugin appears as a new Loader entry. A reload of the interface is what
makes the browser half run: the page boots against the module graph the Host
renders into the index, so open a fresh page (or `F5`).

## Use

| Gesture | Effect |
|---|---|
| `Ctrl` + `=` | one step larger |
| `Ctrl` + `Shift` + `=` (the `+` glyph) | one step larger |
| `Ctrl` + `Numpad +` | one step larger |
| `Ctrl` + `-` | one step smaller |
| `Ctrl` + `Numpad -` | one step smaller |
| `Ctrl` + `0` / `Ctrl` + `Numpad 0` | back to 100% |

On macOS the primary modifier is `Cmd` instead of `Ctrl`.

The ladder is `50% 60% 70% 80% 90% 100% 110% 125% 150% 175% 200%`, and the
choice is remembered per browser origin. A brief percentage appears at the
bottom of the window when the scale changes.

The first three gestures are also registered as application commands
(`view.zoomIn`, `view.zoomOut`, `view.zoomReset`), so they show up in
**Settings → Keyboard shortcuts** and can be rebound there.

## How it works

```
src/index.ts     Host half — an inert Cordis row
src/client.ts    Browser half — the plugin, the controller, and the two input paths
src/scale.ts     ladder, clamping, and preference persistence (DOM-free)
src/gestures.ts  key classification (DOM-free)
src/document.ts  the only module that writes to the document
scripts/build.mjs        both halves, including the module-table envelope
scripts/verify-build.mjs executes the built bundle against the facade
tests/unit/              logic and controller behaviour
tests/system/            the built bundle in a real engine
```

Two input paths are active at once, deliberately:

- **The shortcut registry** (`ctx.shortcuts.register`). This is the path that
  makes the gestures discoverable and rebindable, and it is how the rest of the
  product wires commands.
- **A capture-phase `keydown` listener.** The registry's code validator accepts
  only `KeyA–Z`, `Digit0–9` and function keys, so numeric-pad codes cannot be
  expressed as a binding at all; the `Ctrl+Shift+=` spelling of `+` also needs
  its own handling. The listener covers both.

Electron forwards a registry-matched binding to the page as ordinary input, so
one physical press can surface on both paths. A 60 ms guard window keeps that
press to a single step.

The scale itself is one inline `zoom` declaration on the root element.
`zoom` scales the *used* value of `width`, `height` and `font-size` in modern
engines, so nested percentage layouts reflow and the shell keeps covering the
viewport at every rung. A stylesheet rule would be equally correct but would
couple the effect to a stylesheet having loaded — which is exactly the failure
this plugin must not have.

### The module-table envelope

An out-of-tree client bundle has to reproduce an envelope that the in-repo build
pipeline normally emits. `scripts/build.mjs` writes it explicitly, because two
details of it are load-bearing and neither is obvious from reading a shipped
bundle:

1. The global is **`window.__ModuleLoader__`**. First-party bundles read
   `ow.__ModuleLoader__`, but `ow` is a local alias the bundler declares *inside
   its own output*. A plugin has no such scope, and copying the alias fails at
   boot with `Uncaught ReferenceError: ow is not defined` — which the Harness
   reports as `1 entry did not activate` and refuses to start.
2. The factory's **return value** is the module exports. The envelope may
   declare `module` and `exports`, but nothing reads `module.exports`; a factory
   that assigns to `exports` and returns nothing yields `undefined` and the row
   never mounts (`import failed`).

`npm run build` fails if either invariant is broken in the output, and
`tests/system/` executes the built artifact against the real facade in a real
engine, so the envelope cannot silently regress.

## Development

```sh
npm install
npm run check     # typecheck, build, unit tests, bundle contract, system tests
```

`npm run test:system` needs a Chromium-based browser (Chrome, Edge or Chromium).
It reports a **skip** rather than a pass when none is found, so a missing browser
can never look like a green run.

## Known limitations

These are properties of doing interface zoom from inside a sandboxed renderer,
not bugs that more code would fix:

- **`getBoundingClientRect()` reports scaled coordinates.** Any layout code that
  measures an element and then positions something in document pixels sees the
  scaled value while the scale is not 100%. The shipped shell has not been
  observed to misbehave, but a plugin that does pointer-driven geometry should
  divide by the scale.
- **The document is clipped while scaled** (`html{overflow:hidden}`, installed
  only while the scale is not 100%). Without it the zoomed coordinate space adds
  a stray scrollbar; with it, a page that relied on document-level scrolling
  would scroll less. The shell scrolls inside its own containers.
- **`vw`/`vh` units are scaled too**, which is the correct behaviour for a zoomed
  coordinate space and the reason the shell keeps fitting the window.
- **The proper mechanism would be `webFrame.setZoomLevel()`.** That is the
  Electron browser zoom, with no layout-unit or measurement side effects, but the
  desktop preload does not expose it to the renderer. If a future Harness exposes
  a zoom bridge on `dshDesktop`, this plugin should be rewritten to call it and
  the CSS path retired.

## License

MIT
