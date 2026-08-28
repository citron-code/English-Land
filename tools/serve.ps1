# Minimal static file server for local preview (no Node/Python needed).
#   powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 5173
param(
  [int]$Port = 5173,
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$Root = (Resolve-Path $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try {
  $listener.Start()
} catch {
  Write-Error "Could not start HttpListener on port $Port : $_"
  exit 1
}
Write-Host "English Land dev server -> http://localhost:$Port/  (root: $Root)"

$mime = @{
  ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8";
  ".mjs"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8";
  ".json"="application/json"; ".png"="image/png"; ".jpg"="image/jpeg";
  ".jpeg"="image/jpeg"; ".gif"="image/gif"; ".svg"="image/svg+xml";
  ".webp"="image/webp"; ".ico"="image/x-icon"; ".glb"="model/gltf-binary";
  ".gltf"="model/gltf+json"; ".bin"="application/octet-stream";
  ".wasm"="application/wasm"; ".map"="application/json";
  ".mp3"="audio/mpeg"; ".ogg"="audio/ogg"; ".wav"="audio/wav";
  ".woff"="font/woff"; ".woff2"="font/woff2"; ".ttf"="font/ttf"
}

$shotDir = Join-Path $Root "tools\shots"
if (-not (Test-Path $shotDir)) { New-Item -ItemType Directory -Path $shotDir | Out-Null }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    # ---- POST /save?name=foo : write a data-URL / base64 PNG from the page to tools/shots ----
    if ($req.HttpMethod -eq "POST" -and $req.Url.AbsolutePath -eq "/save") {
      $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
      $body = $reader.ReadToEnd()
      $reader.Close()
      $body = $body -replace '^data:image/\w+;base64,', ''
      $name = $req.QueryString["name"]; if ([string]::IsNullOrWhiteSpace($name)) { $name = "shot" }
      $name = ($name -replace '[^\w\-]', '_')
      $file = Join-Path $shotDir "$name.png"
      [System.IO.File]::WriteAllBytes($file, [Convert]::FromBase64String($body))
      $res.StatusCode = 200
      $res.Headers.Add("Access-Control-Allow-Origin", "*")
      $buf = [Text.Encoding]::UTF8.GetBytes("saved $file")
      $res.OutputStream.Write($buf, 0, $buf.Length)
      $res.OutputStream.Close()
      continue
    }

    $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
    $rel = $rel -replace '/', '\'
    $path = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))

    if ($path.StartsWith($Root) -and (Test-Path $path -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] }
      $res.Headers.Add("Cache-Control", "no-store")
      $res.Headers.Add("Access-Control-Allow-Origin", "*")
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $buf = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
  } catch {
    try { $res.StatusCode = 500 } catch {}
  } finally {
    try { $res.OutputStream.Close() } catch {}
  }
}
