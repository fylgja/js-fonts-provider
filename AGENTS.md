# Agent guide

A dependency free Node library that resolves web font families from a provider API, downloads the woff2 files and renders the `@font-face` rules and CSS variables.
Its scope is that and nothing else: how the families are configured, where the CSS is stored and when it runs belongs to the project using it.

This is the source of truth for [`fylgja/php-fonts-provider`](https://github.com/fylgja/php-fonts-provider), which mirrors its API and output byte for byte. A change here should land there as well, its `tests/parity/run.sh` compares the two.

## Layout

| File | |
| --- | --- |
| `index.js` | The public exports. |
| `src/generate.js` | `normalize()` and `generate()`: resolve, download, measure. |
| `src/config.js`, `src/weight.js` | Validating the families and filling in the defaults. |
| `src/providers/` | One file per provider, each turns a family into faces. `css2.js` covers Google Fonts and Bunny Fonts. |
| `src/api/` | Parsing provider stylesheets and shared face handling. |
| `src/metrics.js`, `src/fallback.js` | Reading font metrics and building the fallback face. |
| `src/render.js`, `src/result.js` | The CSS, the preload links and the result object. |
| `src/storage.js`, `src/http.js` | The fonts folder and the requests. |

## Rules

- **No dependencies.** Node's `fetch`, `zlib` and `fs` cover everything.
- **Everything printed is validated.** The families can come from a form, so any value that ends up in CSS, a file name or a URL is checked in `config.js` (config) or `isSafeFace()` (provider responses). Add a check for every new option.
- **Downloads are checked.** https only, the provider's hosts (`allowsDownload()`), the woff2 signature and `maxFileSize`.
- **No request in `normalize()`.** Validation must work offline, so a form can show errors before anything is fetched.
- **One family failing never fails the run.** It becomes a warning, unless `strict` is set.
- **Deterministic output.** Requests run in parallel, but warnings, faces and downloads keep the order of the config.

## Tests

`npm test` runs on recorded HTTP responses in `tests/fixtures/http`, keyed by the SHA-1 of the URL, the same fixtures as the PHP version.
A test that makes a new request fails with the URL. Run `FONTS_RECORD=1 npm test` to record it from the live API. Fontshare files are replaced by an OFL font (`tests/fixtures/fonts/substitute.*`), since their license does not allow redistributing them.

## Code style

- ES modules, tabs, double quotes and semicolons, the Fylgja license header on top of every file.
- JSDoc on every function: a short description, `@param` and `@returns`. Comment why, not what.
- US English in code and docs.

Commit with the house style: a prefix (`ADD`, `IMP`, `DEL`, `FIX`, `UPD`), imperative mood, around 50 characters.
