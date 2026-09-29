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

A **restart of the application** is what picks the row up, and then a **reload of
the interface** is what makes the browser half run.

Both steps are load-bearing. Mounting the row gives the Host a new Loader entry,
but the bundle URL it advertises is composed into the module graph, and adding a
client entry to an already-running application leaves that graph holding the
previous composition. A page that was already open loaded its graph at boot, so
it will not have this row either.

After the restart, the plugin appears as a Loader entry named
`<profile package name>`, and the interface reload serves its browser half from
`/plugins/<name>/client.js`.

Two failure modes are worth recognizing:

| Symptom | Cause |
|---|---|
| `1 entry did not activate` / `import failed` at startup | the bundle failed to execute — see [The module-table envelope](#the-module-table-envelope) |
| the row is active but the gestures do nothing | the interface was not reloaded after the row mounted |

The recovery dialog offers to disable third-party plugins, which rewrites the
profile patch from scratch. If you use it, the `insert` block above has to be
added again.

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
src/index.ts     Host half — the diagnostic mirror
src/client.ts    Browser half — the plugin, the controller, and the two input paths
src/scale.ts     ladder, clamping, and preference persistence (DOM-free)
src/gestures.ts  key classification (DOM-free)
src/document.ts  the only module that writes to the document
src/trace.ts     write-only failure journal (browser side)
src/journal.ts   reading that journal back out of local storage (Node side)
scripts/build.mjs          both halves, including the module-table envelope
scripts/verify-build.mjs   executes the built bundle against the facade
scripts/install-profile.mjs copies a build into a profile with a matching id
tests/unit/                logic, controller, journal, and trace behaviour
tests/system/              the built bundle in a real engine
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

The scale itself is a `transform` on the application root, with inverse sizing
so the shell still covers the window:

```css
transform-origin: 0 0;
transform: scale(S);
width:  calc(100% / S);
height: calc(100% / S);
```

The transform is what keeps the rest of the UI correct. A `zoom` declaration is
the more obvious choice, but it lands inside `getBoundingClientRect()`, so a
floating layer positioned from a measured rect gets scaled a second time when
`position: fixed` resolves against the zoomed initial containing block. Measured
gap below an anchored button, where 8px is correct:

| scale | `zoom` on `:root` | `transform` on the shell |
|---|---|---|
| 100% | 8 | 8 |
| 70% | −201 | 8 |
| 110% | 77 | 8 |
| 125% | 179 | 8 |
| 150% | 348 | 8 |

A transform leaves every element's used geometry alone, so a menu anchored to a
button keeps landing on the button at every scale. `tests/system/` asserts that
gap at seven different scales; it is the regression this mechanism exists for.
The inverse sizing is the price of using a transform: a transform does not
reflow, so without it the shell would keep its unscaled layout box and leave a
gap at the right and bottom edges. Laying the shell out at `100% / S` and then
scaling it by `S` restores the bounding box, so its percentage children still
divide the real viewport.

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

3. The envelope's `id` must equal the **row name** the bundle is mounted under.
   That name is baked in at build time, so mounting a bundle under a different
   row name makes the registration check fail with nothing but `import failed` to
   show for it. `scripts/install-profile.mjs` copies a build into a profile and
   rewrites the id to match, which is the supported way to install under a
   different name:

   ```sh
   npm run build
   node scripts/install-profile.mjs ~/.dsh/profiles/desktop @your/name
   ```

### Diagnosing an activation failure

A sandboxed renderer is opaque from the outside: its console cannot be read, and
the Harness crash report covers only application-fatal errors. A per-entry
activation failure therefore leaves no trace anywhere — which makes it very hard
to tell "the plugin did not run" from "the plugin ran and the gesture did not
arrive".

This plugin removes that blind spot. The browser half appends short markers to a
journal in the page's own storage, and the Host half mirrors that journal to
`$DSH_HOME/ui-zoom-trace.log` once per second:

| Marker | Meaning |
|---|---|
| `M:module` | the bundle executed; the factory is registered |
| `A:apply` | the Host mounted the plugin and `apply` was called |
| `A:locale-failed` / `A:controller-failed` | that step threw, with the message |
| `C:restored=<scale>` | the stored preference was applied |
| `C:root=<tag>` | the element that was scaled, or `<absent>` when the shell had not mounted a root yet |
| `C:selftest=<value>` | the applied transform read back from the engine (`<none>` means accepted-but-inert) |
| `C:listening` | the key listener is installed |
| `A:ready:<scale>` | the plugin is fully mounted |
| `K:<code>:<mods>` | a key event reached the document (recorded by a separate witness listener) |

The journal is capped at 200 entries, every write is failure-contained, and
nothing about it changes the plugin's behaviour.

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

- **The document is clipped while scaled** (`html{overflow:hidden}`, installed
  only while the scale is not 100%). With the transform mechanism the document's
  own scroll metrics no longer change, so this is a guard against a fractional
  scale producing an edge scrollbar rather than a requirement. A page that relied
  on document-level scrolling would scroll less; the shell scrolls inside its own
  containers.
- **The root element is addressed by selector.** The plugin scales `#root`, then
  `[data-dsh-app-root]`, then `body`. A composition with none of those would scale
  the body, which is still correct but also scales anything the host page mounts
  beside the application.
- **Layout is measured in document pixels, so a plugin that mixes its own
  scaling with measured rects must stay consistent.** The transform does not
  change any element's used geometry, which is precisely why anchored layers now
  work; the remaining wrinkle is that the *visual* size of a box differs from its
  layout size by the scale, which is what the inverse sizing reconciles at the
  root.
- **The proper mechanism would be `webFrame.setZoomLevel()`.** That is the
  Electron browser zoom, with no layout-unit or measurement side effects at all,
  but the desktop preload does not expose it to the renderer. If a future Harness
  exposes a zoom bridge on `dshDesktop`, this plugin should be rewritten to call
  it and the CSS path retired.

## License

MIT
