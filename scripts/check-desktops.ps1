Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class VDCheck {
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
    private interface IVDM {
        [PreserveSig] int A(IntPtr h, out bool b);
        [PreserveSig] int B(IntPtr h, out Guid g);
    }
    public static string Check(IntPtr h) {
        try {
            Type t = Type.GetTypeFromCLSID(new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a"));
            IVDM v = (IVDM)Activator.CreateInstance(t);
            bool on; v.A(h, out on);
            Guid g; v.B(h, out g);
            return "onCurrent=" + on + " desktop=" + g.ToString().Substring(0,8);
        } catch (Exception e) { return "err=" + e.Message.Substring(0, 50); }
    }
}
'@
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
    $title = if ($_.MainWindowTitle.Length -gt 30) { $_.MainWindowTitle.Substring(0,30) } else { $_.MainWindowTitle }
    $r = [VDCheck]::Check($_.MainWindowHandle)
    Write-Host "$($_.ProcessName) | $title | $r"
}
