# 指示71 追記：デスクトップに「あつまれ TV」のショートカットを作る（TVを開く.cmd と同じ起動のしかた）。
# 使い方：このファイルを右クリック →「PowerShell で実行」。1回だけ。Windows の設定は何も変えない（ショートカットを1つ置くだけ）
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Host "Chrome が見つかりません"; exit 1 }
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'あつまれ TV.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $chrome
$s.Arguments = "--user-data-dir=`"$env:LocalAppData\AtsumareTV`" --autoplay-policy=no-user-gesture-required --no-first-run"
$s.Description = 'あつまれ TV（TV 専用の Chrome）'
$s.Save()
Write-Host "作りました：$lnk"
