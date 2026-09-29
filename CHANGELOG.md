# Changelog

## Unreleased

### Fixed

- **Anchored floating layers no longer drift as the scale grows.** The scale was
  applied as a `zoom` declaration on the document, which lands inside
  `getBoundingClientRect()`, so a menu positioned from a measured rect was scaled
  a second time and walked away from its anchor — measured gap below an anchored
  button was 77px at 110%, 179px at 125%, and 348px at 150%, against a correct
  8px. Scaling is now a `transform` on the application root with inverse sizing,
  which leaves every element's used geometry intact and holds the gap at 8px
  across the whole ladder. `tests/system/` asserts that gap at seven scales.

### Added

- A failure journal: the browser half appends short markers to the page's own
  storage and the Host half mirrors them to `$DSH_HOME/ui-zoom-trace.log`, so an
  activation failure — which a sandboxed renderer otherwise hides completely — is
  answerable from disk. Documented in the README with the marker table.
- `scripts/install-profile.mjs`, which copies a build into a profile and rewrites
  the envelope's `id` to the row name. Mounting a bundle under a different row
  name otherwise fails the registration check with nothing but `import failed` to
  show for it.
- Unit tests for the journal reader and the trace writer (101 unit tests total).

### Changed

- Every step of `apply` is failure-contained, so a shortcut-registry or locale
  problem degrades the plugin instead of failing its activation.
- The Host half takes a narrower context type, since it uses only the effect API.

## 1.0.0

First release.

- Interface zoom on `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, with the numeric pad and the
  `Ctrl+Shift+=` spelling of `+` accepted as well; `Cmd` on macOS.
- Eleven-rung ladder from 50% to 200%, remembered per browser origin.
- `view.zoomIn`, `view.zoomOut` and `view.zoomReset` registered as application
  commands, so the gestures appear in Settings → Keyboard shortcuts and can be
  rebound there.
- Transient percentage readout when the scale changes.
- Build-time assertion of the two load-bearing properties of the module-table
  envelope (the `window.__ModuleLoader__` global and a factory that returns its
  exports), plus a system test that executes the built bundle against the real
  facade in a real engine.
