# Fylgja Fonts Provider

Self host web fonts from Fontsource, Google Fonts, Bunny Fonts and Fontshare in any Node project.
It resolves a list of font families, downloads the woff2 files, and renders the `@font-face` rules and CSS variables, including a fallback face with metric overrides so the page does not shift when the font arrives.

No dependencies: it uses the `fetch` and Brotli built into Node.
Where the CSS goes, how the families are configured and when to run it is up to the project, such as a build step or a CMS.

A [PHP version](https://github.com/fylgja/php-fonts-provider) with the same API and output is available as well.

## Installation

```sh
npm install @fylgja/fonts-provider
```

Requires Node 20 or newer.

## Usage

```js
import fs from "node:fs/promises";
import { generate } from "@fylgja/fonts-provider";

const result = await generate([
	{ name: "Inter", weights: ["100 900"], styles: ["normal", "italic"], preload: true },
	{ name: "Lora", provider: "google-fonts", weights: [400, 700], cssVariable: "--font-heading", fallbacks: ["Georgia", "serif"] },
], { storage: "public/fonts", urlBase: "/fonts" });

await fs.writeFile("src/css/fonts.css", result.css());
```

`generate()` asks the providers which files a family needs and downloads the ones that are not in the fonts folder yet.
Run it when the fonts change and keep the CSS it returns. Rendering a page needs no request.

### Validating first

`normalize()` validates the families without any request, so a form can show every error before saving:

```js
import { normalize } from "@fylgja/fonts-provider";

const config = normalize(input);

if (!config.valid) {
	return config.errors; // ['fonts[0].weights lists "400" and "300 700", which cover the same weight. ...']
}
```

`generate()` throws a `ConfigError` with the same `errors` when the config is invalid, before any request is made.

### Result

| Method | Returns |
| --- | --- |
| `css()` | The `@font-face` rules followed by the CSS variables. |
| `fontFaceCss()` | Only the `@font-face` rules, the faces and the fallback faces. |
| `variablesCss()` | Only the selector blocks declaring the CSS variables. |
| `variables()` | The font stack per CSS variable, such as `{ "--font-heading": 'Inter, "Inter fallback", sans-serif' }`, to declare them yourself. |
| `preloads()` | A `{ family, file, url, type }` for every file of a family with `preload` set. |
| `preloadHtml()` | `<link rel="preload" as="font" type="font/woff2" href="..." crossorigin>` per preload. |
| `downloaded()` | The number of files downloaded in this run. |

And the properties `families` (each with its `font`, `faces`, `fallbackFace` and `metrics`), `downloads` (a `{ url, file, status, error }` per file, with `status` one of `downloaded`, `present` or `failed`) and `warnings`.

A family that could not be resolved is not an error, since the rest of the fonts still work.
It is listed in `warnings`, and its CSS variable is still declared with only the fallbacks.
Pass `strict: true` to throw a `WarningError` instead, which holds the result as `result`.

When you keep the CSS of an earlier run, keep it when a run has warnings, so a provider that is down never removes a working font.

### Options

| Option | Default | |
| --- | --- | --- |
| `storage` | `"fonts"` | The fonts folder, a path or a [storage](#storage). |
| `urlBase` | `"/fonts"` | Path or URL of the fonts folder as the page sees it, such as a CDN URL. |
| `cssSelector` | `":root"` | Selector for the CSS variables of families that do not name one. |
| `force` | `false` | Download every file again, even when it is present. |
| `strict` | `false` | Throw a `WarningError` when there are warnings. |
| `maxFileSize` | `10485760` | A larger font file is refused. |
| `providers` | `defaultProviders()` | The providers, see [Providers](#providers). |
| `fetch` | `globalThis.fetch` | The `fetch` to make requests with, for a proxy or a test. |

## Configuration

Each family is an object of options.

| Key | Default | |
| --- | --- | --- |
| `name` | required | The family name. |
| `provider` | `"fontsource"` | `fontsource`, `google-fonts`, `bunny-fonts`, `fontshare` or `local`. |
| `id` | slug of `name` | The id in the provider's URLs, for the rare family where it differs (Fontshare spells JetBrains Mono `jet-brains-mono`). |
| `cssVariable` | `"--font-<slug>"` | The leading `--` is added when missing. Must be unique. |
| `cssSelector` | the `cssSelector` option | Selector to declare the variable in. |
| `weights` | `["400"]` | Single weights, or a range such as `"100 900"` (also `"100..900"` or `"100-900"`) for a variable font. |
| `styles` | `["normal"]` | `normal` and `italic`. |
| `subsets` | `["latin"]` | Ignored by Fontshare, which serves one file per family. |
| `fallbacks` | `["sans-serif"]` | The rest of the font stack. |
| `display` | `"swap"` | The `font-display` value. |
| `preload` | `false` | List the files in `preloads()`. |
| `adjustFallback` | `true` | Add a fallback face with metric overrides. |

The `local` provider serves files that are already in the fonts folder.
Instead of weights and styles it takes `variants`, each with a `src` list of paths relative to the fonts folder, and optionally `weight`, `style`, `stretch`, `unicodeRange` and `display`.

Every value that ends up in the CSS, a file name or a URL is validated, so the families can come from a form.

### Providers

| Provider | Variable fonts | Subsets | Files from |
| --- | --- | --- | --- |
| `fontsource` | yes | yes | `cdn.jsdelivr.net` |
| `google-fonts` | yes | yes | `fonts.gstatic.com` |
| `bunny-fonts` | no | yes | `fonts.bunny.net`, `cdn.jsdelivr.net` |
| `fontshare` | no | no | `cdn.fontshare.com` |
| `local` | yes | no | the fonts folder |

A file is only downloaded over https from the hosts its provider serves fonts from, must start with the woff2 signature, and must stay under `maxFileSize`.
Each provider is a function, to replace one with other hosts or add your own:

```js
import { defaultProviders, fontsource, generate } from "@fylgja/fonts-provider";

const providers = [...defaultProviders(), fontsource({ downloadHosts: ["cdn.jsdelivr.net", "fonts.example.com"] })];
const result = await generate(fonts, { providers });
```

A provider with the same `id` replaces the earlier one.
Adobe Fonts is not supported, since its license does not allow self hosting the files.

## Fallback metrics

The fallback face scales a local font (Arial for `sans-serif`, Times New Roman for `serif`, Courier New for `monospace`, or a named one such as Georgia) to the size of the webfont.
Its numbers are measured from the first file of the family, which `readMetrics()` reads from a woff2, woff, ttf or otf.
When the file cannot be measured, the family has no fallback face and a warning says so.

## Storage

A path stores the fonts in that folder. To store them elsewhere, pass an object with paths relative to the fonts folder:

```js
const storage = {
	exists: async (path) => boolean,
	read: async (path) => Buffer | null,
	write: async (path, contents) => {},
	location: () => "s3://bucket/fonts", // used in messages
};
```

Files are never deleted. The file names only depend on the family, subset, weight and style, so families that share a folder share their files.

## Development

```sh
npm test                    # on recorded HTTP responses
FONTS_RECORD=1 npm test     # record the responses a new test needs
```

## License

MIT
