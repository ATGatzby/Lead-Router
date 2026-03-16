# Documentation Page — Implementation Plan

## Context
The dashboard nav has a "Documentation" link that currently goes nowhere (`href="#"`). We need a dedicated docs page with left sidebar navigation, migrating the existing setup guide content into the dark theme, plus sections for videos, FAQ, troubleshooting, and changelog. This gives users a central place to learn the product and gives us a structure to add content over time.

## Decisions
- **Public access** — no login required (good for SEO + prospects)
- **Dark theme** — matches dashboard/marketing site
- **Sections**: Setup Guide, How To Videos, FAQ, Troubleshooting, Changelog

---

## Files to Create
- `site/docs.html` — the main documentation page

## Files to Modify
- `site/shared.css` — add docs-specific CSS classes
- `site/dashboard.html` — update Documentation nav link `href="#"` → `href="/docs.html"`
- `site/index.html` — update Documentation nav link if it exists there too

## Reference Files (read-only, for content migration)
- `docs/setup-guide.html` — source content (2847 lines, 15 steps across 4 groups)

---

## Implementation Steps

### Step 1: Add docs CSS to `site/shared.css`
Add a `/* -- Docs -- */` section with these classes:

- `.docs-layout` — CSS Grid: `240px 1fr 200px` (sidebar / content / TOC)
- `.docs-sidebar` — fixed left sidebar, glassmorphism style, scrollable, with search input
- `.docs-sidebar-section` — category labels (uppercase, small, `var(--text-tertiary)`)
- `.docs-sidebar a` — nav links with left-border active indicator (`var(--accent-blue)`)
- `.docs-sidebar .step-num` — numbered step circles (gradient when active)
- `.docs-content` — main content column, `max-width: 780px`, `scroll-margin-top` for anchors
- `.docs-toc` — right sticky TOC rail (auto-populated by JS from current section's h3s)
- `.docs-breadcrumb` — breadcrumb trail at top of content
- `.docs-section` — content section wrapper
- `.docs-video-card` — 16:9 video placeholder with play icon, easy to swap `data-video-id`
- `.docs-prev-next` — bottom previous/next navigation cards
- `.docs-callout` — info/warning/tip callout boxes (reuse alert-banner pattern)
- `.docs-faq-item` — accordion-style FAQ with toggle
- `.docs-changelog-entry` — timeline-style changelog entries

Responsive breakpoints:
- `≤1200px`: hide right TOC, content expands
- `≤768px`: hide sidebar → hamburger menu overlay, full-width content

### Step 2: Create `site/docs.html`
Three-part layout structure:

```
┌──────────────────────────────────────────────┐
│  Top Nav (site-nav, "Documentation" active)  │
├──────────┬───────────────────┬───────────────┤
│ Sidebar  │  Breadcrumb       │  Sticky TOC   │
│ 240px    │  Content sections │  "On this     │
│          │  (scrollable)     │   page"       │
│ Search   │                   │  200px        │
│ ──────── │                   │               │
│ Getting  │                   │               │
│ Started  │                   │               │
│ ──────── │                   │               │
│ Setup    │                   │               │
│ Guide    │                   │               │
│ (steps)  │                   │               │
│ ──────── │                   │               │
│ Resources│                   │               │
│  Videos  │  Prev / Next      │               │
│  FAQ     │                   │               │
│  Trouble │                   │               │
│  Change  │                   │               │
└──────────┴───────────────────┴───────────────┘
```

**Sidebar sections:**
1. **Getting Started** — Overview
2. **Setup Guide** — Steps 1-15 migrated from `docs/setup-guide.html` (grouped: VPS/DNS, Connected App, CLI, Onboarding, Integrations, License Users, Teams, Routes, Route Builder, English View, Triggers, Fuzzy Matching, Verify, Activity, AI Assistant)
3. **Resources** — How To Videos, FAQ, Troubleshooting, Changelog

**Content migration from setup guide:**
- Re-theme all cards → `.dash-card` pattern
- Re-theme code blocks → `.cli-block` pattern (dark terminal style)
- Re-theme info/warning boxes → `.docs-callout` variants
- Keep all screenshots/images, add dark border treatment
- Keep architecture diagram, re-theme boxes to glassmorphism

**Video section:**
- Grid of `.docs-video-card` placeholders
- Each has `data-video-id` attribute — clicking swaps placeholder with YouTube/Vimeo iframe
- Easy to update: just change the `data-video-id` and title text
- Start with 2-3 placeholder cards ("Getting Started", "Building Your First Route", "AI Matching")

**FAQ section:**
- Accordion-style questions with click-to-expand
- Extract common questions from existing troubleshooting content
- Add product-specific FAQs (pricing, SFDC requirements, etc.)

**Changelog section:**
- Timeline-style entries with date, version, and description
- Start with current version (v0.5.0) and a few placeholder entries

**JavaScript (inline at bottom):**
1. `IntersectionObserver` — track active section, update sidebar highlight + breadcrumb
2. Right TOC auto-population — scan current section's `h3` elements
3. Mobile hamburger toggle — sidebar overlay on/off
4. Client-side search — filter sidebar links by text match
5. Copy-to-clipboard — for all code blocks
6. Video embed — swap placeholder with iframe on click
7. FAQ accordion — toggle answer visibility
8. Prev/Next updater — based on current active section

### Step 3: Update navigation links
- `site/dashboard.html` line 28: `href="#"` → `href="/docs.html"`
- `site/index.html`: update Documentation nav link if present

### Step 4: Add redirect from old setup guide
Add `<meta http-equiv="refresh" content="0; url=/docs.html#vps">` to `docs/setup-guide.html` head so existing bookmarks still work. (Or just leave both alive.)

---

## Verification
1. Open `site/docs.html` in browser — confirm dark theme renders correctly
2. Click through all sidebar links — smooth scroll to correct sections
3. Resize to mobile — sidebar collapses, hamburger works
4. Click a video placeholder — confirm iframe swap (or "coming soon" if no ID)
5. Click FAQ items — accordion expands/collapses
6. Copy a code block — clipboard works
7. Navigate from dashboard → Documentation link lands on docs page
8. Right TOC updates as you scroll between sections
9. Breadcrumb updates on scroll
