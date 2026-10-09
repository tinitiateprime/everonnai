param([Parameter(Mandatory = $true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$targetPath = [System.IO.Path]::GetFullPath($OutputPath)
$targetDirectory = [System.IO.Path]::GetDirectoryName($targetPath)
if ([System.IO.Path]::GetDirectoryName($targetDirectory).TrimEnd('\') -ne [System.IO.Path]::GetTempPath().TrimEnd('\') -or
    -not [System.IO.Path]::GetFileName($targetDirectory).StartsWith('everonn-assistant-live-') -or
    [System.IO.Path]::GetFileName($targetPath) -ne 'question.wav') {
    throw 'The speech fixture must be written inside the isolated assistant test directory.'
}
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$memory = New-Object System.IO.MemoryStream
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
try {
    $english = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name.StartsWith('en') } | Select-Object -First 1
    if (-not $english) { throw 'An English Windows speech voice is required for this explicit speech check.' }
    $synth.SelectVoice($english.VoiceInfo.Name)
    $synth.SetOutputToAudioStream($memory, $format)
    $synth.Speak('What are your Saturday hours, and what is wheel truing?')
    $speech = $memory.ToArray()
} finally { $synth.Dispose(); $memory.Dispose() }
$leading = New-Object byte[] (48000 * 2 * 12)
$trailing = New-Object byte[] (48000 * 2 * 25)
$dataSize = $leading.Length + $speech.Length + $trailing.Length
$file = [System.IO.File]::Open($targetPath, [System.IO.FileMode]::CreateNew)
$writer = New-Object System.IO.BinaryWriter($file)
try {
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
    $writer.Write([int](36 + $dataSize))
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
    $writer.Write([int]16)
    $writer.Write([int16]1)
    $writer.Write([int16]1)
    $writer.Write([int]48000)
    $writer.Write([int]96000)
    $writer.Write([int16]2)
    $writer.Write([int16]16)
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
    $writer.Write([int]$dataSize)
    $writer.Write($leading)
    $writer.Write($speech)
    $writer.Write($trailing)
} finally { $writer.Dispose(); $file.Dispose() }
