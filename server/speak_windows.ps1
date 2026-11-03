param([Parameter(Mandatory=$true)][string]$RequestFile,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$localRequest=Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$localSpeech=[System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $localSpeech.SelectVoice([string]$localRequest.voice)
    $localSpeech.Rate=[int]$localRequest.rate
    $localFormat=[System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
    $localSpeech.SetOutputToWaveFile($OutputFile,$localFormat)
    $localSpeech.Speak([string]$localRequest.text)
} finally { $localSpeech.Dispose() }
