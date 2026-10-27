# Form error recovery review

October 27, 2026. Bounded guide-to-workflow review against the pushed 3053f6bf source, using fictional local browser inputs and intercepted responses. This is not a user study or a whole-app accessibility audit.

## Guidance read

- W3C WAI form notifications: https://www.w3.org/WAI/tutorials/forms/notifications/ . Errors should be clear, linked to the control, and explain correction. Success and asynchronous status also need feedback.
- W3C WAI validation: https://www.w3.org/WAI/tutorials/forms/validation/ . Validate usable input, support correction, retain appropriate confirmation/undo. Client checks do not replace server validation.
- Nielsen Norman Group error guidelines: https://www.nngroup.com/articles/error-message-guidelines/ . Place actionable messages near the error; use plain words and preserve user effort rather than raw technical responses.
- GOV.UK error message: https://design-system.service.gov.uk/components/error-message/ and validation pattern: https://design-system.service.gov.uk/patterns/validation/ . Retain inputs and connect errors to labels; distinguish field errors from service failures. GOV.UK specifically disables native HTML validation for its tested components, while W3C supports native required/type validation. That implementation rule is not universal and was not copied wholesale.

## Reproduced issues and bounded changes

1. Sync Server URL was outside the form, so a syntactically invalid `not-a-url` enabled Sign in and sent a same-origin relative request. The candidate checks an absolute HTTP(S) URL before login/register, with field-specific error and focus. Loopback HTTP, LAN addresses, IPv6 and path-prefixed self-host URLs remain valid. Embedded credentials, query and fragment suffixes are rejected rather than silently forwarding credentials to an unintended endpoint. Registration policy and backend are unchanged.
2. Sync failures exposed raw HTTP/body strings. Known authentication, closed-registration, server/path/rate and network failures now have concise recovery copy. Fields stay in place, errors use alert semantics and success/pending use status semantics. Pending button labels say Signing in / Creating account. Raw server payloads are not reflected. Unknown failures do not claim a specific cause.
3. Appearance Style/Mode/Reset storage failures previously threw uncaught errors and showed no feedback. The candidate catches them, keeps visible selection consistent with actual saved/current state, and announces an actionable error. The error scrolls into view without stealing keyboard focus. A partially completed two-choice reset is not called unchanged; its message explicitly says current choices are shown. Font/wallpaper choices and the approved Inter default are untouched.

## Evidence and limits

Browser repro and after checks at1440 and390 show invalid URL generates zero requests and focuses Server URL; mocked401 keeps fictional username/password for correction; mocked403 explains closed registration; storage failures in style/mode/reset show visible feedback without uncaught page errors. Panels fit horizontally. Before/after screenshots were inspected directly. Existing keyboard suite,314 app tests (311 baseline+3 helper tests) and TypeScript/Vite build pass.

No real authentication, sync, provider, deployed origin or device was used. Form feedback tests intercept all auth responses. Server-side validation, registration policy, CORS, token handling and sync conflict policy are unchanged. These changes do not prove notification announcements in an actual screen reader or whole-app WCAG conformance.
