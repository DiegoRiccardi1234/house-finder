# House Finder design

Existing implementation: ui/src/index.css and ui/src/ui/.

Use the established restrained sage accent and warm sand surfaces. Preserve both light and dark themes and semantic surface, ink, muted, accent, warn and danger tokens. Do not introduce a new palette.

Newsreader is the heading font; Manrope is body text; Space Grotesk is the established compact action/label face. All fonts remain self-hosted. Prose is limited to about 72 characters per line.

Reuse Button, Field, Input, Select, Tabs, Alert, Card and ConfirmDialog. Preserve lazy-mounted tabs so unsaved input survives navigation. Settings should use labelled rows and progressive disclosure, with explicit save, diagnostics and synthetic test actions.

The approved addition is a Chat navigation tab and a Connections/Tasks/Diagnostics section inside existing AI settings. Chat shows the selected context before sending, local history and a cancel action. MCP proposals show details before confirmation. No decorative animations or new image generation is required; the existing house identity is reused.
