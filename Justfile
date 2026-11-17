# Start the DSH web development loop (build + watch + foreground server).
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# Show the usage guide without starting a server.
default:
    @node scripts/dev.mjs --help

dev *args:
    @node scripts/dev.mjs {{args}}
