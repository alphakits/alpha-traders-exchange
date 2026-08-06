$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "set-discord-env.mjs"
node $scriptPath
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
