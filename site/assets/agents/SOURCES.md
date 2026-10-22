# Official product marks — local preview only

**Publication is blocked pending trademark permission review.** Download availability is not an open graphic license. In particular, Anthropic requires prior approval of materials, and Google requires product-icon permission requests. Do not deploy the website or distribute app builds containing these marks until the owner resolves those requirements. No permission was requested or obtained by this change.

These small marks identify Time Machine's integration status, not customers, sponsors or endorsements. Claude Code automatic hooks are built; Codex CLI, Gemini CLI and Cursor integrations are planned. MCP agents can use seven implemented tools; this does not mean automatic hooks exist for those other products.

## Sources

Retrieved 21 October 2026. The same four SVG files are used here and in `apps/desktop/src/renderer/agents/`.

| Local file | Exact official asset source | How the source is established |
| --- | --- | --- |
| `claude.svg` | https://assets.claude.com/95a868946ac8a31e5ff832e2899f294aa368b836.png?w=128&h=128 | `https://claude.com/` declares this asset as its icon (the page uses `?w=32&h=32`). The download returned a 32 × 32 WebP despite the PNG URL. |
| `openai.svg` | https://openai.com/favicon.svg | Official OpenAI site's own self-contained adaptive Blossom favicon; not a Codex-specific logo. Used alongside the visible Codex CLI name and Planned status. |
| `gemini.svg` | https://gemini.google/images/spark_4c.png | `https://gemini.google/about/` declares `/images/spark_4c.png` as its icon. Download returned a 128 × 128 WebP despite the PNG URL. |
| `cursor.svg` | https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip | The download is linked directly by https://cursor.com/brand. Exact archive member: `General Logos/Cube/SVG/CUBE_2D_DARK.svg`. This is Cursor's official asset host, not an unrelated logo CDN. |

Claude and Gemini source pixels were decoded to PNG with macOS `sips -s format png` and embedded in self-contained SVG image containers to preserve the renderer's `.svg` asset contract. No tracing, invented logo paths, intentional recoloring, cropping or geometric modification. These two files are raster images inside SVG, not vector reconstructions. OpenAI and Cursor SVG contents are retained as supplied. None contains scripts, external image references or external stylesheets.

## Usage and release constraints

- **Claude / Anthropic:** https://www.anthropic.com/legal/trademark-guidelines requires use specifically permitted by Anthropic and materials approved beforehand, no alteration of color/font/proportion, reasonable surrounding space, a readable background, and no implied endorsement. The policy covers names as well as graphics and does not itself offer a general plain-text exception. An informational/nominative text-only alternative therefore needs the owner's legal judgment, not an invented permission claim.
- **OpenAI:** https://openai.com/brand/ and https://openai.com/brand/#usage-terms grant conditional, non-exclusive, non-transferable permission subject to the guide; marks must relate directly to OpenAI services, remain unmodified, be subordinate to the user's own branding, and never imply endorsement. OpenAI may require changes or terminate permission. Its Blossom must not be the app's primary branding. The original favicon's black/white adaptation and internal whitespace are retained. Factual plain-text product references remain the lower-risk alternative; the guide requires precision about models/services. This does not establish a partnership.
- **Gemini / Google:** https://partnermarketinghub.withgoogle.com/brands/google/branding-guidelines/how-to-show-googles-brand/#product-icons says to create a Partner Marketing Hub account and request permission to use product icons. Product-specific guidance at https://partnermarketinghub.withgoogle.com/brands/google-gemini/brand-introduction/ is login-gated. https://about.google/brand-resource-center/guidance/ explicitly permits informational plain-text references to Google/products subject to https://about.google/brand-resource-center/rules/. Do not infer icon permission from this text-only permission. Google's brand must not imply sponsorship or dominate Time Machine's own identity.
- **Cursor / Anysphere:** https://cursor.com/brand supplies the downloadable assets for consistent and accurate representation, permits the cube separately, calls 2D the default, and specifies the name “Cursor,” not “Cursor AI” or “Cursor Code.” It does not state an unrestricted graphic license. https://cursor.com/terms-of-service section 5.1 reserves rights and says there are no implied licenses in those terms. Permission review remains necessary; factual text-only product identification is an alternative, not a claimed graphic grant.

No third-party mark is covered by Time Machine's MIT license. All rights remain with the respective owners. The website visibly disclaims endorsement.

## Display treatment

Keep the original colors and aspect ratios: no CSS filters, tinting, masks or opacity effects. Website images are 24 × 24 CSS pixels with `object-fit: contain`, in 40 × 40 slots providing 8 px of open space on every side; OpenAI retains its supplied additional internal whitespace. This is the local preview treatment, **not a claim that provider-specific approval/clearspace requirements have been satisfied**. Claude's source is 32 × 32; do not enlarge it beyond that without obtaining a higher-resolution official asset. Names and support status are always visible, and paired images use empty alt text. Browser layout/a11y verification belongs to the integrating agent; no build, test or browser checks were run for this asset change.
