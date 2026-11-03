param([Parameter(Mandatory=$true)][string]$TargetPath,[Parameter(Mandatory=$true)][string]$AliasPath)
$ErrorActionPreference='Stop'
$localTarget=(Get-Item -LiteralPath $TargetPath).FullName
if (Test-Path -LiteralPath $AliasPath) {
    $localItem=Get-Item -LiteralPath $AliasPath
    if ($localItem.LinkType -ne 'Junction' -or ([string]$localItem.Target).TrimEnd('\') -ne $localTarget.TrimEnd('\')) { throw 'Existing alias belongs to another target' }
} else {
    New-Item -ItemType Directory -Path (Split-Path -Parent $AliasPath) -Force | Out-Null
    New-Item -ItemType Junction -Path $AliasPath -Target $localTarget | Out-Null
}
