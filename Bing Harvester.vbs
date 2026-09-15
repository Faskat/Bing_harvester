' Bing Harvester без окна консоли.
'   двойной клик                     — открыть окно приложения
'   Bing Harvester.vbs --scheduled   — запуск по расписанию (так его вызывает Планировщик заданий)
Option Explicit

Dim sh, fso, dir, args, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

' Нет Node.js или зависимостей — открываем установщик, он всё объяснит
If sh.Run("cmd /c where node", 0, True) <> 0 Or Not fso.FolderExists(dir & "\node_modules\playwright-core") Then
  If WScript.Arguments.Count = 0 Then sh.Run """" & dir & "\install.cmd""", 1, False
  WScript.Quit 1
End If

If WScript.Arguments.Count > 0 Then
  args = ""
  For i = 0 To WScript.Arguments.Count - 1
    args = args & " " & WScript.Arguments(i)
  Next
  WScript.Quit sh.Run("node src\run.mjs" & args, 0, True)
Else
  sh.Run "node src\app.mjs", 0, False
End If
