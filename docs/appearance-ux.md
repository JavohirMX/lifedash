# Appearance and Settings UX notes

Reviewed October 27, 2026. This is a bounded reference comparison, not a user study or a claim that Lifedash has the same capabilities as these products.

## References and choices

- Vikunja Settings: https://vikunja.io/help/settings/ documents System, Light and Dark color schemes and groups preferences by purpose. Lifedash keeps the same familiar mode choices and groups its existing connection/display and notification controls. It does not copy Vikunja's account or notification delivery features.
- Actual Settings: https://actualbudget.org/docs/settings/ puts themes in Settings and explains device-specific versus shared settings. Lifedash explicitly says appearance is saved on this device. Sync behavior is unchanged.
- Actual Custom Themes: https://actualbudget.org/docs/custom-themes/ uses palette previews and immediate selection. Lifedash's eight built-in style cards now preview their actual light/dark palettes instead of mixing signature light and dark swatches regardless of the selected mode. No remote catalog, CSS import, remote requests or arbitrary CSS execution is added.

## Implemented interaction details

Settings shows the current appearance combination. Appearance labels the current style and mode, including the system-resolved mode, and marks the selected style in text as well as by a border. Mode and style remain independent, apply immediately and retain their existing keyboard behavior. Use defaults resets only appearance to Paper + System, leaving data and other preferences alone.

Notification states say On, Off, Blocked or Unavailable. A saved journal nudge says Paused if task reminders are off or unavailable, matching the existing delivery gate. It does not silently clear the saved preference. Supporting text explains what to do and that notifications only arrive while the app is open.

The self-host setup link opens the bundled guide in a new tab without discarding the sync form. The guide is maintained separately; this link does not make container runtime or full onboarding verified.

## Verification

Run `npm run build`, `npm test` and `npm run test:keyboard` from app. With a local Vite server running, run `BASE_URL=http://127.0.0.1:PORT node scripts/settings-appearance-smoke.mjs`. Optional SCREENSHOT_DIR captures evidence.

The focused script uses fictional sample data and no real provider, sync or notification calls. It covers desktop, phone and small/short phone widths; all sixteen built-in style/mode palette combinations; persisted choices; appearance-only defaults; system mode tracking; keyboard radio selection; paused, blocked and unsupported notification states; and panel overflow. Actual notifications, real devices and whole-app accessibility conformance are not covered.
