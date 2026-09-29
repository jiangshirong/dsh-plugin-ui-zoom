# Changelog

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
