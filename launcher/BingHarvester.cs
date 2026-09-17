// Bing Harvester.exe — запуск без консоли: встроенный Node.js (runtime\node.exe) + src\app.mjs.
//   двойной клик                       — окно приложения
//   "Bing Harvester.exe" --scheduled   — запуск по расписанию (так его вызывает Планировщик заданий)
// Собирается scripts/build.mjs компилятором C# из .NET Framework, который есть в каждой Windows 10/11.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

static class Launcher
{
    const string Title = "Bing Harvester";

    [STAThread]
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        bool scheduled = args.Contains("--scheduled");

        string node = Path.Combine(dir, "runtime", "node.exe");
        if (!File.Exists(node)) node = FindOnPath("node.exe");
        if (node == null || !Directory.Exists(Path.Combine(dir, "node_modules", "playwright-core")))
        {
            Fail(scheduled, "Сборка повреждена: не хватает runtime\\node.exe или node_modules.\nСкачайте архив заново и распакуйте его целиком.");
            return 1;
        }

        var psi = new ProcessStartInfo(node)
        {
            WorkingDirectory = dir,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        string script = Path.Combine(dir, "src", scheduled ? "run.mjs" : "app.mjs");
        psi.Arguments = string.Join(" ", new[] { script }.Concat(args).Select(Quote).ToArray());
        // Планировщику нужен путь к exe, а не к node.exe
        psi.EnvironmentVariables["BH_LAUNCHER"] = Application.ExecutablePath;
        // Рядом есть data\ — портативный режим; иначе вход и настройки живут в %LOCALAPPDATA% и переживают обновление
        if (string.IsNullOrEmpty(psi.EnvironmentVariables["BH_DATA"]) && !Directory.Exists(Path.Combine(dir, "data")))
        {
            psi.EnvironmentVariables["BH_DATA"] = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BingHarvester");
        }

        Process process;
        try
        {
            process = Process.Start(psi);
        }
        catch (Exception e)
        {
            Fail(scheduled, "Не удалось запустить: " + e.Message);
            return 1;
        }
        if (!scheduled) return 0;
        process.WaitForExit();
        return process.ExitCode;
    }

    // По расписанию окон с ошибками не показываем — некому нажать «ОК»
    static void Fail(bool quiet, string text)
    {
        if (!quiet) MessageBox.Show(text, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    static string Quote(string s)
    {
        if (s.Length > 0 && s.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return s;
        return "\"" + s.Replace("\"", "\\\"") + "\"";
    }

    static string FindOnPath(string exe)
    {
        foreach (string d in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try
            {
                string candidate = Path.Combine(d.Trim(), exe);
                if (File.Exists(candidate)) return candidate;
            }
            catch (ArgumentException)
            {
            }
        }
        return null;
    }
}
