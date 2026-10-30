// Built-in preview tokens match styles.css in light and dark mode.
export const THEME_PREVIEWS = {
  "paper": {
    "light": {
      "--p-ground": "#f7f7f4",
      "--p-surf": "#ffffff",
      "--p-rule": "#e5e5df",
      "--p-acc": "#0f766e"
    },
    "dark": {
      "--p-ground": "#111110",
      "--p-surf": "#1b1b19",
      "--p-rule": "#2d2d2a",
      "--p-acc": "#4fb3a8"
    }
  },
  "terminal": {
    "light": {
      "--p-ground": "#f2f5ef",
      "--p-surf": "#fbfdf9",
      "--p-rule": "#b9c8b3",
      "--p-acc": "#086a2b"
    },
    "dark": {
      "--p-ground": "#0b0f0c",
      "--p-surf": "#101712",
      "--p-rule": "#25402c",
      "--p-acc": "#4ade80"
    }
  },
  "editorial": {
    "light": {
      "--p-ground": "#f6f0e4",
      "--p-surf": "#fffaf0",
      "--p-rule": "#d8c9a9",
      "--p-acc": "#8c2f39"
    },
    "dark": {
      "--p-ground": "#1a1612",
      "--p-surf": "#231e18",
      "--p-rule": "#3d3427",
      "--p-acc": "#e08a8f"
    }
  },
  "soft": {
    "light": {
      "--p-ground": "#f5f3fb",
      "--p-surf": "#ffffff",
      "--p-rule": "#e3ddf3",
      "--p-acc": "#5b49c8"
    },
    "dark": {
      "--p-ground": "#16151f",
      "--p-surf": "#201e2d",
      "--p-rule": "#302d44",
      "--p-acc": "#a99bff"
    }
  },
  "contrast": {
    "light": {
      "--p-ground": "#ffffff",
      "--p-surf": "#ffffff",
      "--p-rule": "#000000",
      "--p-acc": "#0030c0"
    },
    "dark": {
      "--p-ground": "#000000",
      "--p-surf": "#000000",
      "--p-rule": "#ffffff",
      "--p-acc": "#ffd400"
    }
  },
  "nexus": {
    "light": {
      "--p-ground": "#e8eaf6",
      "--p-surf": "#f6f7fd",
      "--p-rule": "#b9c0e8",
      "--p-acc": "#5f4de0"
    },
    "dark": {
      "--p-ground": "#0b0d1a",
      "--p-surf": "#141830",
      "--p-rule": "#2c3464",
      "--p-acc": "#a198ff"
    }
  },
  "compact": {
    "light": {
      "--p-ground": "#f4f6f8",
      "--p-surf": "#ffffff",
      "--p-rule": "#c3cdd6",
      "--p-acc": "#0e7490"
    },
    "dark": {
      "--p-ground": "#101418",
      "--p-surf": "#161c22",
      "--p-rule": "#2e3944",
      "--p-acc": "#22b8cf"
    }
  },
  "polar": {
    "light": {
      "--p-ground": "#f6f9fc",
      "--p-surf": "#ffffff",
      "--p-rule": "#b8cadd",
      "--p-acc": "#2563eb"
    },
    "dark": {
      "--p-ground": "#0d1420",
      "--p-surf": "#131c2c",
      "--p-rule": "#2c3d5c",
      "--p-acc": "#60a5fa"
    }
  }
} as const;
