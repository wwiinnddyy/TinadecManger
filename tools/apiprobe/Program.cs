using System.Reflection;
foreach (var name in new[] { "Aprillz.MewUI.Backend.Direct2D", "Aprillz.MewUI.Backend.Gdi", "Aprillz.MewUI.Backend.MewVG.Win32", "Aprillz.MewUI.Backend.MewVG.X11", "Aprillz.MewUI.Backend.MewVG.MacOS" })
{
    try
    {
        var asm = Assembly.Load(name);
        foreach (var t in asm.GetTypes().Where(t => t.IsPublic && (t.Name.Contains("Backend") || t.Name.Contains("Factory") || t.Name.Contains("Graphics"))))
            foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly).Where(m => m.Name.Contains("Register") || m.Name.StartsWith("Use")))
                Console.WriteLine($"{name}: {t.FullName}.{m.Name}({string.Join(",", m.GetParameters().Select(p => p.ParameterType.Name))})");
    }
    catch (Exception ex) { Console.WriteLine($"{name}: LOAD FAIL {ex.Message}"); }
}
