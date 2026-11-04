@echo off
rem 指示71 追記（くまくんの答え 2026-11-04）：TV の PC の Chrome を、TV 専用のプロフィールで開く。
rem  --user-data-dir … ふだんの Chrome が開いていても、別の Chrome として開く（下のフラグが効く）。拡張機能と係のログインも、このプロフィールで1回だけする
rem  --autoplay-policy=no-user-gesture-required … 人が押さなくても音が出る（あそびまちのチャイム・あつまれの TV の音）
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
start "" "%CHROME%" --user-data-dir="%LocalAppData%\AtsumareTV" --autoplay-policy=no-user-gesture-required --no-first-run
