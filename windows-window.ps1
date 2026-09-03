param(
    [string]$Hwnd,
    [ValidateSet("desktop", "normal", "top")]
    [string]$Mode
)

$sourcePath = Join-Path $PSScriptRoot "windows-window.cs"
if (-not ("WindowApi" -as [type])) {
    try {
        Add-Type -Path $sourcePath -ErrorAction Stop
    } catch {
        Write-Error "Error compiling C#: $_"
        exit 1
    }
}

$handle = [IntPtr]::new([long]$Hwnd)
try {
    switch ($Mode) {
        "desktop" {
            [WindowApi]::SetDesktop($handle)
        }
        "normal"  { [WindowApi]::SetNormal($handle) }
        "top"     { [WindowApi]::SetTop($handle) }
    }
} catch {
    Write-Error "Error running WindowApi: $_"
    exit 1
}