$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$publicOutput = Join-Path $projectRoot 'public\print-setup'
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stage = Join-Path $temporaryRoot ('cargo-print-check-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $stage -Force
$null = New-Item -ItemType Directory -Path $publicOutput -Force
try {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'extension') -Destination (Join-Path $stage '연결확인도구') -Recurse
  $guide = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'guide.html') -Raw -Encoding utf8
  [System.IO.File]::WriteAllText((Join-Path $publicOutput 'index.html'), $guide, [System.Text.UTF8Encoding]::new($false))
  $offlineGuide = $guide.Replace('<a class="download" href="cargo-print-connection-check.zip" download>연결 확인 도구 다운로드</a>', '<p class="note">압축을 이미 푸셨다면 아래 <strong>2번</strong>부터 진행하세요.</p>')
  [System.IO.File]::WriteAllText((Join-Path $stage '처음읽어주세요.html'), $offlineGuide, [System.Text.UTF8Encoding]::new($false))
  $archive = Join-Path $publicOutput 'cargo-print-connection-check.zip'
  Compress-Archive -LiteralPath @((Join-Path $stage '연결확인도구'), (Join-Path $stage '처음읽어주세요.html')) -DestinationPath $archive -Force
  Get-Item -LiteralPath $archive | Select-Object Name, Length
  Get-FileHash -LiteralPath $archive -Algorithm SHA256 | Select-Object Algorithm, Hash
} finally {
  $resolvedStage = [System.IO.Path]::GetFullPath($stage)
  $parent = [System.IO.Path]::GetFullPath((Split-Path -Path $resolvedStage -Parent)).TrimEnd('\')
  if ($parent -ne $temporaryRoot.TrimEnd('\') -or -not (Split-Path -Path $resolvedStage -Leaf).StartsWith('cargo-print-check-')) {
    throw 'Temporary packaging path did not pass the cleanup boundary check.'
  }
  if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}
