param([int]$Port=18748,[switch]$Lan)
$ErrorActionPreference='Stop'
$localBind = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
python (Join-Path $PSScriptRoot 'server\app.py') --host $localBind --port $Port
