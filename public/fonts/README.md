# Bundled fonts

Served from `/fonts/` and declared in `src/ui/fonts.css`: the interface, the film overlay and the 3D labels
need no network access for their fonts.

| File | Family | Weights | Version | License |
|---|---|---|---|---|
| `fraunces-variable-latin.woff2`, `fraunces-variable-latin-ext.woff2` | Fraunces (variable, axes `opsz` 9–144 and `wght` 100–900) | 100–900 | 1.000 (Google Fonts v38) | SIL OFL 1.1, `OFL-Fraunces.txt` |
| `ibm-plex-sans-variable-latin.woff2`, `ibm-plex-sans-variable-latin-ext.woff2` | IBM Plex Sans (variable, axis `wght`) | 100–700 | 3.201 (Google Fonts v23) | SIL OFL 1.1, `OFL-IBM-Plex.txt` |
| `ibm-plex-sans-condensed-{500,600,700}-latin.woff2`, `…-latin-ext.woff2` | IBM Plex Sans Condensed (static) | 500, 600, 700 | 1.3 (Google Fonts v15) | SIL OFL 1.1, `OFL-IBM-Plex.txt` |

- **Source**: WOFF2 files served by the Google Fonts CSS2 API (`fonts.gstatic.com`), downloaded on 2026-10-07 and
  copied without modification. Upstream projects: <https://github.com/undercasetype/Fraunces> and <https://github.com/IBM/plex>.
- **Subsets**: Google Fonts split, `unicode-range` ranges copied as is into `fonts.css`.
  - `latin`: U+0000–00FF, Œ œ, ‘ ’ “ ” – — … (general punctuation U+2000–206F), €, ™, −. Enough for French.
  - `latin-ext`: Ÿ and the other accented Latin letters (names of places in neighboring countries: ł, ř, ő…).
  - The browser downloads a subset only if the displayed text contains one of its characters.
- **Total size**: 310,552 bytes (≈ 303 KiB) for the 10 WOFF2 files; in practice the interface only loads Fraunces and IBM Plex Sans `latin`
  (113,016 bytes, ≈ 110 KiB), plus IBM Plex Sans Condensed `latin` (≈ 58 KiB) with the "broadcast" overlay style.
- Glyphs missing from these fonts (narrow no-break space U+202F, →, ≈, ▶, ❚) are drawn with a system font.
