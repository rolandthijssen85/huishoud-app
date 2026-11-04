' Start automatisch-bijwerken.ps1 zonder zichtbaar venster (voor de geplande taak).
Set fso = CreateObject("Scripting.FileSystemObject")
map = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & map & "\automatisch-bijwerken.ps1"""
code = CreateObject("WScript.Shell").Run(cmd, 0, True)
WScript.Quit code
