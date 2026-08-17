!macro customInstall
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\connection-runtime\windows-firewall.ps1" -Action Install -ProgramPath "$INSTDIR\AetherX.exe"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "AetherX 未能配置专用局域网连接。请允许管理员授权，或查看 C:\ProgramData\AetherX\installer-firewall.log。"
  ${EndIf}
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\connection-runtime\windows-firewall.ps1" -Action Uninstall'
!macroend
