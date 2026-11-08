# 指示71 追記：デスクトップに「あつまれ TV」のショートカットを作る（TVを開く.cmd と同じ起動のしかた）。
# 使い方：このファイルを右クリック →「PowerShell で実行」。1回だけ。Windows の設定は何も変えない（ショートカットを1つ置くだけ）
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Host "Chrome が見つかりません"; exit 1 }
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'あつまれ TV.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $chrome
# 指示75 3-8：起動のたびに /tvs/mark を開く（拡張機能が TV 専用の Chrome と覚える）。前に作ったショートカットは、これを1回実行して作り直す
$s.Arguments = "--user-data-dir=`"$env:LocalAppData\AtsumareTV`" --autoplay-policy=no-user-gesture-required --no-first-run `"https://aresoredorekore.duckdns.org/tvs/mark`""
$s.Description = 'あつまれ TV（TV 専用の Chrome）'
$s.Save()
Write-Host "作りました：$lnk"
