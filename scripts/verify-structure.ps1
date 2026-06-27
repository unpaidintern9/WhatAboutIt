$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$required = @(
  "app",
  "external-repos",
  "agents",
  "skills",
  "docs",
  "scripts",
  "assets",
  "assets\branding",
  "assets\placeholders",
  "core",
  "plugins",
  "services",
  "themes",
  "learning",
  "research",
  "README.md",
  "agents\brand-guardian-agent.md",
  "docs\BRAND_SYSTEM.md",
  "docs\CODING_STANDARDS.md",
  "docs\PLUGIN_ARCHITECTURE.md",
  "docs\DESIGN_TOKENS.md",
  "docs\COMPONENT_LIBRARY.md",
  "docs\AUTO_EDIT_ARCHITECTURE.md",
  "docs\LEARNING_ARCHITECTURE.md",
  "docs\ARCHITECTURE_REVIEW.md",
  "docs\dependency-audit\obs-studio.md",
  "themes\what-about-it\colors.json",
  "themes\what-about-it\typography.json",
  "themes\what-about-it\spacing.json",
  "themes\what-about-it\components.json",
  "themes\what-about-it\icons.json",
  "themes\what-about-it\textures.json",
  "themes\what-about-it\animations.json"
)

foreach ($item in $required) {
  $path = Join-Path $root $item
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing required project item: $item"
  }
}

Write-Host "What About It? Studio structure verified."
