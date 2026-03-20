' PeonForge — Send keystrokes to a specific terminal window by title
Set WshShell = CreateObject("WScript.Shell")

Dim keys, windowTitle
If WScript.Arguments.Count >= 1 Then keys = WScript.Arguments(0) Else keys = ""
If WScript.Arguments.Count >= 2 Then windowTitle = WScript.Arguments(1) Else windowTitle = "Claude"

If keys = "" Then WScript.Quit

' Activate by window title (partial match)
WshShell.AppActivate windowTitle
WScript.Sleep 200

' Send the keys
WshShell.SendKeys keys
