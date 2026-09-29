# PDF.js local viewer dependency

- Package: `pdfjs-dist` 5.6.205 (Mozilla PDF.js).
- Origin: the trusted Codex bundled Node dependency distribution.
- License: Apache-2.0, in `LICENSE`. The CMaps, standard fonts, WASM decoders and ICC resources retain their own included licenses.
- Copied without modification: `build/pdf.mjs`, `build/pdf.worker.mjs`, `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/`.
- The application imports the module only when opening a PDF. No CDN, remote viewer, viewer scripting sandbox, forms, annotation DOM, external links or embedded attachment extraction is used.
- Original documents stay unchanged on the local machine. The byte fetch uses the existing short-lived same-origin file capability, with a 20 MiB limit. Only one page is rendered at a time, with a 4,000,000-pixel / 4096-edge canvas limit and a 30-second operation timeout.

Do not substitute a CDN path or bundle a local runtime's absolute path into the published application.
