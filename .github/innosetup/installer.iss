; Single-file Windows installer for Tinadec Manager.
;
; Electrobun's own Windows output is not a single file: `Setup.exe` is a bare
; extractor that expects `Setup.tar.zst` next to it, and the two are shipped
; inside a .zip. This script wraps the unpacked bundle directory in one
; executable installer instead.
;
; CI invokes: ISCC.exe /DVersion=<ver> /DOutputDir=<win-path> installer.iss

#ifndef Version
  #define Version "0.0.0-dev"
#endif

#ifndef OutputDir
  #define OutputDir "."
#endif

#define AppName "Tinadec Manager"
#define AppPublisher "Tinadec"
; Relative to this script's directory, i.e. the repo's unpacked/ output.
#define BundleDir "..\..\unpacked\TinadecManger"

[Setup]
AppId=TinadecManger
AppName={#AppName}
AppVersion={#Version}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\TinadecManger
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
LicenseFile=..\..\LICENSE
OutputDir={#OutputDir}
OutputBaseFilename=TinadecManger-Setup-{#Version}-win-x64
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayName={#AppName}
; The launcher writes under %APPDATA%\TinadecManger, not {app}, so uninstall
; never has to touch user data.
PrivilegesRequired=admin

[Files]
; bin\launcher.exe dlopens libNativeWrapper.dll from its own directory and loads
; the app from ..\Resources, so the whole tree must stay together.
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\bin\launcher.exe"; WorkingDirectory: "{app}\bin"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\bin\launcher.exe"; WorkingDirectory: "{app}\bin"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\bin\launcher.exe"; WorkingDirectory: "{app}\bin"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\bin"
Type: filesandordirs; Name: "{app}\Resources"
Type: filesandordirs; Name: "{app}\lib"
