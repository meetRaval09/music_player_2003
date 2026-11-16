# Pixel Tunes 2003 - Spotify helper. Runs hidden. Prints one JSON line per second about the
# Spotify song, and obeys commands dropped into the command file (toggle / next / prev / play / pause).
param([string]$CmdFile, [string]$CoverDir)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type); $n = $t.Invoke($null, @($op)); $n.Wait(-1) | Out-Null; $n.Result }
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Find-Spotify { foreach ($s in $mgr.GetSessions()) { if ($s.SourceAppUserModelId -like '*Spotify*') { return $s } } return $null }
function Say($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

$lastKey = ''; $coverPath = ''; $coverN = 0; $tick = 0
while ($true) {
  try {
    $s = Find-Spotify
    if (Test-Path $CmdFile) {
      $cmd = (Get-Content $CmdFile -Raw).Trim(); Remove-Item $CmdFile -Force -ErrorAction SilentlyContinue
      if ($s) {
        if ($cmd -eq 'toggle') { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
        elseif ($cmd -eq 'next') { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
        elseif ($cmd -eq 'prev') { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
        elseif ($cmd -eq 'play') { [void](Await ($s.TryPlayAsync()) ([bool])) }
        elseif ($cmd -eq 'pause') { [void](Await ($s.TryPauseAsync()) ([bool])) }
        $tick = 3   # report right away
      }
    }
    if ($tick -eq 3) {
      if (-not $s) { Say @{ ok = 0 } }
      else {
        $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $key = $p.Title + '|' + $p.Artist
        if ($key -ne $lastKey) {
          $lastKey = $key; $coverPath = ''
          try {
            if ($p.Thumbnail) {
              $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
              $coverN++; $coverPath = Join-Path $CoverDir ("cover" + $coverN + ".img")
              $in = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st)
              $fs = [System.IO.File]::Create($coverPath); $in.CopyTo($fs); $fs.Close(); $in.Close()
            }
          } catch { $coverPath = '' }
        }
        $tl = $s.GetTimelineProperties()
        $pos = $tl.Position.TotalSeconds
        $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
        $playing = ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing')
        if ($playing) {                                   # Windows updates the time only now and then: add the gap
          $gap = ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
          if ($gap -gt 0 -and $gap -lt 30) { $pos += $gap }
        }
        if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
        Say @{ ok = 1; title = [string]$p.Title; artist = [string]$p.Artist; playing = $playing; pos = [math]::Floor($pos); dur = [math]::Floor($dur); cover = $coverPath }
      }
    }
  } catch { Say @{ ok = 0; err = $_.Exception.Message } }
  $tick = ($tick + 1) % 4
  Start-Sleep -Milliseconds 250
}
