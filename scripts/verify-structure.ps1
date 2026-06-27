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
  "research",
  "README.md",
  "agents\brand-guardian-agent.md",
  "docs\BRAND_SYSTEM.md",
  "app\themes\what-about-it.json"
)

foreach ($item in $required) {
  $path = Join-Path $root $item
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing required project item: $item"
  }
}

Write-Host "What About It? Studio structure verified."

