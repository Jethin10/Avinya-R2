"""Prepare the authorised San Rita snapshot for a local, offline Vite preview.

The page itself remains the original production HTML/CSS/JavaScript.  This script only
localises asset URLs, removes analytics/browser-extension capture shims, repairs HTML
entities that the page-saving extension escaped inside inline JavaScript, and appends the one
line that loads the SETU layer.

That last step is deliberately the only edit that adds anything to the page. SETU is a module
appended before ``</body>``: it never replaces the site's own markup, so React hydrates exactly
the DOM it shipped, and everything SETU draws lives in nodes React never created.
"""

from __future__ import annotations

import html as html_module
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LIVE_SOURCE = ROOT / "source" / "index.html.live"
ARCHIVE_SOURCE = ROOT / "source" / "index.html.orig"
SOURCE = LIVE_SOURCE if LIVE_SOURCE.exists() else ARCHIVE_SOURCE
TARGET = ROOT / "index.html"


def unescape_inline_script(match: re.Match[str]) -> str:
    opening, body = match.group(1), match.group(2)
    if " src=" in opening:
        return match.group(0)
    return f"{opening}{html_module.unescape(body)}</script>"


SETU_ENTRY = '<script type="module" src="/src/setu/main.js"></script>'


# The captured page is visual scaffolding for SETU. Rebrand every user-facing phrase that can
# survive into first paint or the hydrated React stream so the prototype reads as one product.
# Keep replacements deliberately specific: asset paths and implementation references to San Rita
# remain untouched because they are not visible copy and still resolve the captured design system.
COPY_REPLACEMENTS = (
    ("The trails of San Rita", "SETU · DISTRICT TWIN"),
    ("A creative studio", "SETU"),
    ("where brands and", "DISASTER RESPONSE"),
    ("stories move off-trails", "DISTRICT TWIN"),
    ("Scroll to enter our world", "Scroll into the twin"),
    ("©2026 - Atelier San Rita Inc.", "©2026 · SETU · Disaster Response Twin"),
    ("Atelier San Rita Inc.", "SETU · Disaster Response Twin"),
    ("Design + Development + Branding + content creation", "Signals + silence + verification + dispatch"),
    ("Design, development & content creation Purveyors", "Reports, silence, risk and response in one operational twin"),
    ("Design & Development", "Disaster intelligence"),
    ("Design & development", "Signal fusion"),
    ("Republic of collaborative minds", "Shared operational truth"),
    ("Explore our Work", "Open the operational twin"),
    ("Some Trails of San Rita are temporarily closed for restoration until Spring 2026", "Routes update as access, reports and hazards change"),
    ("Who we are", "What SETU sees"),
    ("For now contact us at", "Built for district incident command"),
    ("Show trails", "Show response routes"),
    ("Hide trails", "Hide response routes"),
    ("LATEST HOT SPOT ADDED", "ACTIVE INCIDENT"),
    ("Podium Global", "Wayanad · Meppadi"),
    ("Video production studio | design and Development", "Landslide response · district twin"),
    ("Explore Project", "Open district twin"),
    ("Project Image", "Incident view"),
    ("next project", "next incident"),
    ("view more", "open incident"),
    ("view less", "close incident"),
    ("EST.2024", "WAYANAD · INCIDENT"),
    ("Terraforming", "District twin"),
    ("Data calculation", "Signal intake"),
    ("Atmosphere deployment", "Weather layer"),
    ("Geosystem creation", "Terrain mesh"),
    ("Vegetal matter generation", "Settlement index"),
    ("Ecosystem modeling", "Risk model"),
    ("Rivers and lake deployed", "Drainage layer"),
    ("Known trails emerging", "Route graph"),
    ("Viewpoints activated", "Observation points"),
    ("Metadata processing", "Evidence ledger"),
    ("Initiating the dive into the San Rita universe", "Opening the SETU operational twin"),
    ("Whisper of data awakened", "Field signals connected"),
    ("Breath of the atmosphere invoked", "Weather context resolved"),
    ("Bones of the earth shaped", "Terrain surface resolved"),
    ("Essence of vegetation germinating", "Settlement fabric indexed"),
    ("Weave of the eco-realms forming", "Hazard layers aligned"),
    ("Water veins and lake mirrors revealed", "Drainage network resolved"),
    ("Ancestral trails reemerging", "Response routes available"),
    ("Sacred viewpoints illuminated", "Verification points ranked"),
    ("Memory of the elements harmonizing", "Decision ledger synchronized"),
    ("Contact San Rita", "SETU command channel"),
    ("San Rita Playground", "SETU operations view"),
    ("SAN RITA TEAM - ", "SETU RESPONSE CELL - "),
    ("Project not found", "Incident not found"),
    ("Playground not found", "Operations view not found"),
    ("Everything born from our explorations:", "Signals currently shaping the response:"),
    ("work-in-progress visuals, photography studies, material tests, design sketches, and experimental projects", "field reports, model updates, verification requests, access changes, and dispatch decisions"),
    ("Back to playground", "Back to operations"),
    ("explore live website", "open live incident"),
    ("San rita mountains vibe", "Field observation feed"),
    ("San rita fishing spot", "Remote field signal"),
    ("Purveyors", "operational command layer"),
    ("hand-crafted", "human-verified"),
    ("digital design Refuge", "district response twin"),
    ("Gold idEAs", "value of information"),
    ("Republic of", "shared"),
    ("collaborative minds", "operational truth"),
    ("Fishing spot", "Field signal"),
    ("Viewpoint", "Verified evidence"),
    ("Trail", "Response route"),
    ("Road", "Road network"),
    (
        "San Rita | Designing Stories, Brands &amp; Digital Worlds - Atelier San Rita - Creative Studio",
        "SETU | Disaster Response District Twin",
    ),
    ("San Rita | Designing Stories, Brands &amp; Digital Worlds", "SETU | Disaster Response District Twin"),
    ("San Rita | Designing Stories, Brands &amp; Digital Worlds - Atelier San Rita - Creative Studio", "SETU | Disaster Response District Twin"),
    ("San Rita | Creative Studio Into The Wild", "SETU | Disaster Response District Twin"),
    (
        "A full-service creative studio specializing in custom web design, full-stack development, strategic branding, and digital content creation. ",
        "A disaster-response command system that turns reports, sensor signals and silence into verification, dispatch and auditable decisions. ",
    ),
)


def rebrand_copy(page: str) -> str:
    for old, new in COPY_REPLACEMENTS:
        page = page.replace(old, new)

    # React's flight payload keeps ampersands as JS unicode escapes, so cover those serialized forms
    # in addition to the human-readable HTML above.
    page = page.replace(r"Design \u0026 Development", "Disaster intelligence")
    page = page.replace(r"Design \u0026 development", "Signal fusion")
    page = page.replace(
        r"Design, development \u0026 content creation Purveyors",
        "Reports, silence, risk and response in one operational twin",
    )
    page = page.replace(
        r"Design, development \u0026 content creation operational command layer",
        "Reports, silence, risk and response in one operational twin",
    )
    page = page.replace(
        r"San Rita | Designing Stories, Brands \u0026 Digital Worlds - Atelier San Rita - Creative Studio",
        "SETU | Disaster Response District Twin",
    )
    page = page.replace(
        r"San Rita | Designing Stories, Brands \u0026 Digital Worlds",
        "SETU | Disaster Response District Twin",
    )
    # Preserve the translation key name; only replace its value. A broad `seekers` replacement
    # changes the key itself and makes the captured client fall back to its original copy on hydrate.
    page = page.replace(
        r'home_map_tagline_seekers\":\"seekers',
        r'home_map_tagline_seekers\":\"verify next',
    )
    page = page.replace("Art Direction", "Situational intelligence")
    page = page.replace(r'\"title\":\"Design\"', r'\"title\":\"Verification\"')
    page = page.replace(r'\"title\":\"Development\"', r'\"title\":\"Resource dispatch\"')
    page = page.replace("PODIUM GLOBAL", "WAYANAD RESPONSE")
    page = page.replace("Verified evidences activated", "Observation points")
    page = page.replace('content="sanrita"', 'content="SETU"')
    page = page.replace(r'\"content\":\"sanrita\"', r'\"content\":\"SETU\"')

    # Rebrand the captured site's dormant navigation and fallback surfaces as well. SETU normally
    # hides these behind its command rail, but keeping their copy in-domain prevents studio/social
    # language from flashing during hydration or surfacing on narrow/fallback layouts.
    nav_labels = {
        "map": "twin",
        "projects": "incidents",
        "about": "intelligence",
        "playground": "operations",
        "contact": "command",
        "instagram": "signals",
        "linkedin": "ledger",
    }
    for old, new in nav_labels.items():
        page = page.replace(f">{old}<", f">{new}<")
        page = page.replace(f">{old.title()}<", f">{new.title()}<")

    serialized_nav = {
        r'\"title\":\"Map\",\"link\":\"/\"': r'\"title\":\"Twin\",\"link\":\"/\"',
        r'\"title\":\"Projects\",\"link\":\"/projects\"': r'\"title\":\"Incidents\",\"link\":\"/projects\"',
        r'\"title\":\"About\",\"link\":\"/about\"': r'\"title\":\"Intelligence\",\"link\":\"/about\"',
        r'\"title\":\"Playground\",\"link\":\"/playground\"': r'\"title\":\"Operations\",\"link\":\"/playground\"',
        r'\"title\":\"Contact\",\"link\":\"/contact\"': r'\"title\":\"Command\",\"link\":\"/contact\"',
        r'\"title\":\"Instagram\",\"link\":\"#\"': r'\"title\":\"Signals\",\"link\":\"#\"',
        r'\"title\":\"Linkedin\",\"link\":\"#\"': r'\"title\":\"Ledger\",\"link\":\"#\"',
    }
    for old, new in serialized_nav.items():
        page = page.replace(old, new)

    fallback_copy = {
        "CREDITS": "DECISION SOURCES",
        "Awards + recognition": "VERIFICATION STATUS",
        "Protected Case Study": "Restricted incident",
        "Please enter the password to view this case study.": "Enter an access code to open this incident record.",
        "Enter password": "Access code",
        "Invalid password": "Invalid access code",
        "Access Case Study": "Open incident record",
        "About us picture": "District response overview",
        "About Us": "Response system overview",
    }
    for old, new in fallback_copy.items():
        page = page.replace(old, new)

    page = page.replace(r'project_footer_credits_heading\":\"credits', r'project_footer_credits_heading\":\"sources')
    page = page.replace(r'wip_test_label\":\"test', r'wip_test_label\":\"field note')
    page = page.replace(r'nav_map_legend_road\":\"road', r'nav_map_legend_road\":\"Road network')
    page = page.replace(r'nav_map_legend_trail\":\"trail', r'nav_map_legend_trail\":\"Response route')
    page = page.replace(r'nav_map_legend_viewpoint\":\"viewpoint', r'nav_map_legend_viewpoint\":\"Verified evidence')

    # The captured menu is hidden by SETU, but remove its original studio destinations too so no
    # dormant social/canonical link can take a judge back to the reference site.
    page = page.replace("https://www.instagram.com/sanrita.atelier/", "#")
    page = page.replace("https://www.linkedin.com/company/sanrita/posts/?feedView=all", "#")
    page = page.replace("https://www.linkedin.com/company/sanrita/", "#")
    page = page.replace("https://sanrita.ca", "/")
    page = page.replace("@ateliersanrita", "")
    return page


def attach_setu(page: str) -> str:
    """Load the SETU layer from the end of the body, once.

    Idempotent because this script is re-run by ``predev`` and ``prebuild`` on a target that may
    already carry the tag, and a page with two copies of the entry module would mount two rails.
    The stylesheet is imported by ``main.js`` rather than linked here, so Vite fingerprints it and
    a dev server hot-reloads it.
    """
    if SETU_ENTRY in page:
        return page
    if "</body>" not in page:
        return page + SETU_ENTRY
    return page.replace("</body>", "  " + SETU_ENTRY + "\n</body>", 1)


def main() -> None:
    page = SOURCE.read_text(encoding="utf-8")

    # The archive saver stores origin paths as local folders. Vite exposes the copied
    # production assets from public/ at the root.
    page = page.replace("sanrita.ca/_next/", "/_next/")
    page = page.replace("sanrita.ca/favicon.svg", "/favicon.svg")

    # The captured page preloads local font binaries that are intentionally not distributed with
    # this repository. Keep the snapshot portable by dropping those React-flight preload records;
    # the checked-in stylesheet uses system stacks for the same font variables.
    page = re.sub(
        r':HL\[\\"/_next/static/media/[^\\"]+\.(?:woff2?|ttf|otf)\\",\\"font\\",\{.*?\}\]\\n',
        "",
        page,
    )

    for remote in (
        "https://www.datocms-assets.com/116050/",
        "//www.datocms-assets.com/116050/",
        "www.datocms-assets.com/116050/",
    ):
        page = page.replace(remote, "/img/")

    # Captured browser-extension helpers and telemetry are not part of the authored site and
    # either fail locally or phone home. Removing them does not alter the visual experience.
    patterns = (
        r'<script[^>]*eppiocemhmnlbhjplcgkofciiegomcon[^>]*>\s*</script>',
        r'<script[^>]*googletagmanager[^>]*>\s*</script>',
        r'<script[^>]*cloudflareinsights[^>]*>\s*</script>',
        r'<script[^>]*id="google-analytics"[^>]*>.*?</script>',
        r'<link rel="preload" href="www\.googletagmanager\.com/gtag/js"[^>]*>',
        r'<link rel="expect"[^>]*>',
    )
    for pattern in patterns:
        page = re.sub(pattern, "", page, flags=re.S)

    page = page.replace(
        "https://www.googletagmanager.com/gtag/js?id= G-51KMFQH4N4",
        "about:blank#analytics-removed",
    )
    # The saver captured the already-running clock. Restore the production placeholder so the
    # client can hydrate without a server/client text mismatch, then start its live GMT clock.
    page = re.sub(r"\b\d{2}:\d{2}:\d{2} GMT\b", "--:--:-- GMT", page)
    page = re.sub(
        r"(<script(?![^>]*\ssrc=)[^>]*>)(.*?)</script>",
        unescape_inline_script,
        page,
        flags=re.S,
    )

    page = rebrand_copy(page)
    page = attach_setu(page)

    TARGET.write_text(page, encoding="utf-8")
    print(f"Prepared {TARGET} ({len(page):,} characters)")


if __name__ == "__main__":
    main()
