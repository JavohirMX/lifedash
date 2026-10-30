# Command palette composition guard

Before fix, composing Enter on a "today" query closed the palette and navigated. Input now ignores composing keydown before handling ArrowUp/ArrowDown/Enter. Ordinary arrows and Enter retain navigation. Six1440/390/320light/dark browser groups PASS;315tests/build PASS.390light/320dark rendered views inspected: palette text/options fit. Synthetic browser isComposing events, not native OS IME proof. No changes to global shortcut or shared Escape handler in this patch.
