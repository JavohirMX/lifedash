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

## Font and wallpaper extension

John requested additional fonts, a better default, wallpaper and improved Settings on October 27. The current default remains unchanged until he picks from same-Home Inter / Manrope / IBM Plex Sans previews. All three use identical layout, sample data, style and mode. Inter and Manrope are bundled Fontsource variable font packages (5.3.0, OFL-1.1), not Google Fonts runtime requests. System/serif/monospace options use local device fonts. Match style restores the original style-specific typography.

The Appearance dialog now groups controls into Style & mode, Font and Wallpaper tabs, with accessible arrow-key navigation. Fonts have a readable specimen. Reset style & mode is explicitly narrow: it does not reset fonts, wallpaper, data or notifications. Wallpaper has None, three bundled gradient presets, local image choice, replace/remove, and an intensity slider capped at 35%. Wallpaper is only behind main working screens; solid content surfaces preserve readable text. Wallpaper is off by default.

Images are never uploaded. The browser accepts JPG/PNG/WebP under 10 MB / 40 megapixels, decodes and downsamples to 1600 px, then reencodes as JPEG before bounded localStorage persistence. This strips original file metadata; the stored image is still private browser data. Wallpaper and font preferences are not synced or in JSON exports. Sample preferences use a separate key prefix. Storage failures leave the earlier choice in place and show an error. SVG, remote URLs, malformed persisted data and oversized images fail closed.

Additional references inspected:
- Homepage Settings, https://gethomepage.dev/configs/settings/ : bundled Manrope/IBM Plex Mono, background opacity/filters. Adopted bundled fonts and restrained intensity rather than a remote-image URL field.
- Vikunja Projects, https://vikunja.io/help/projects/ : upload a device image as a project background. Adopted local file choice/remove, but Lifedash deliberately does not upload it.
- Immich Settings, https://docs.immich.app/administration/system-settings : clear configuration groups and reset paths. No arbitrary administrator CSS copied into Lifedash.
- Nielsen Norman Group, https://www.nngroup.com/articles/customization/ : simple discoverable customization, progressive disclosure, and easy revision. Adopted three Appearance sections rather than an endless combined panel.
- Fontsource installation, https://fontsource.org/docs/getting-started/install : bundled self-hosted variable fonts.

Verification: 251 app tests (247 existing + 4 preference-validation tests), TypeScript/build, existing keyboard suite and the focused settings checks. `BASE_URL=http://127.0.0.1:PORT node scripts/personalization-smoke.mjs` covers font choices, wallpaper presets/local upload/rejection/reload/remove, real-vs-sample key isolation, tabs and overflow at1440/390/320. The built production PWA was also reloaded offline, then switched to both bundled fonts successfully. Font files are now included in precache (otherwise a never-used font could fail offline). Actual devices, user-selected photos and whole-app accessibility conformance are not covered.
