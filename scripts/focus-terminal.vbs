' PeonForge — Move Claude terminal to current desktop and focus it
Set WshShell = CreateObject("WScript.Shell")
Dim projectName
If WScript.Arguments.Count > 0 Then projectName = WScript.Arguments(0) Else projectName = ""
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & _
    Replace(WScript.ScriptFullName, "focus-terminal.vbs", "focus-terminal.ps1") & """ -ProjectName """ & _
    projectName & """", 0, True
