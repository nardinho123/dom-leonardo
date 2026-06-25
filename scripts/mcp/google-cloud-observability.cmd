@echo off
set "PATH=%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin;%PATH%"
npx -y @google-cloud/observability-mcp
