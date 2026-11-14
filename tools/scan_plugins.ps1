param(
    [string]$PluginsDir = 'D:\kks\K_K_S\BepInEx\plugins',
    [string]$CoreDir    = 'D:\kks\K_K_S\BepInEx\core',
    [string]$OutFile    = ''
)

$ErrorActionPreference = 'Stop'

# Cecil 用来读程序集元数据；混合模式程序集（C++/CLI）读不了，会记 cecil_ok=false
$cecil = Join-Path $CoreDir 'Mono.Cecil.dll'
if (-not (Test-Path $cecil)) {
    @{ ok = $false; error = "Mono.Cecil.dll not found: $cecil" } | ConvertTo-Json -Compress
    exit 1
}
Add-Type -Path $cecil

# BepInEx 自身版本，用来判断插件是否要求更高版本
$bepVersion = $null
$bepDll = Join-Path $CoreDir 'BepInEx.dll'
if (Test-Path $bepDll) {
    try {
        $a = [System.Reflection.AssemblyName]::GetAssemblyName($bepDll)
        $bepVersion = $a.Version.ToString()
    } catch { }
}

function Get-AttrArg($attr, $idx) {
    if ($null -eq $attr -or $attr.ConstructorArguments.Count -le $idx) { return $null }
    $v = $attr.ConstructorArguments[$idx].Value
    if ($null -eq $v) { return $null }
    return [string]$v
}

$rows = New-Object System.Collections.Generic.List[object]
$files = Get-ChildItem $PluginsDir -Recurse -Filter *.dll -File | Sort-Object FullName
$vbs = Get-ChildItem $PluginsDir -Recurse -File | Where-Object { $_.Extension -in '.off', '.disabled', '.bak' }

foreach ($f in $files) {
    $rel = $f.FullName.Substring($PluginsDir.Length).TrimStart('\')
    $rec = [ordered]@{
        file      = $f.Name
        rel       = $rel
        size      = $f.Length
        mtime     = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        cecil_ok  = $false
        guid      = $null
        name      = $null
        version   = $null
        deps      = @()
        processes = @()
        error     = $null
    }

    # 同目录里如果已有 .off/.disabled 版本，标记出来（说明被禁过）
    $offPath = $null
    foreach ($ext in '.off', '.disabled', '.bak') {
        $cand = $f.FullName + $ext
        if (Test-Path $cand) { $offPath = $cand; break }
    }
    if ($offPath) { $rec['disabled_twin'] = (Split-Path $offPath -Leaf) }

    try {
        $asm = [Mono.Cecil.AssemblyDefinition]::ReadAssembly($f.FullName)
        try {
            $found = $false
            foreach ($t in $asm.MainModule.Types) {
                foreach ($ca in $t.CustomAttributes) {
                    if ($ca.AttributeType.Name -ne 'BepInPlugin') { continue }
                    $rec.guid    = Get-AttrArg $ca 0
                    $rec.name    = Get-AttrArg $ca 1
                    $rec.version = Get-AttrArg $ca 2
                    $rec.cecil_ok = $true
                    $found = $true

                    $deps = New-Object System.Collections.Generic.List[object]
                    foreach ($d in $t.CustomAttributes) {
                        if ($d.AttributeType.Name -eq 'BepInDependency') {
                            $dg = Get-AttrArg $d 0
                            $dv = $null
                            if ($d.ConstructorArguments.Count -gt 1) {
                                $raw = $d.ConstructorArguments[1]
                                # 可能是枚举 DependencyFlags 或 Version 字符串/Version 对象
                                if ($raw.Value -is [string]) { $dv = $raw.Value }
                                elseif ($raw.Value -is [version]) { $dv = $raw.Value.ToString() }
                                else { $dv = $null }
                            }
                            $deps.Add([ordered]@{ guid = $dg; min = $dv })
                        }
                    }
                    $rec.deps = $deps.ToArray()

                    $procs = New-Object System.Collections.Generic.List[string]
                    foreach ($p in $t.CustomAttributes) {
                        if ($p.AttributeType.Name -eq 'BepInProcess') {
                            $pv = Get-AttrArg $p 0
                            if ($pv) { $procs.Add($pv) }
                        }
                    }
                    $rec.processes = $procs.ToArray()
                    break
                }
                if ($found) { break }
            }
        } finally {
            $asm.Dispose()
        }
    } catch {
        $rec.error = $_.Exception.Message
    }
    $rows.Add([pscustomobject]$rec)
}

$result = [ordered]@{
    ok          = $true
    scanned_at  = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    plugins_dir = $PluginsDir
    bepinex     = $bepVersion
    total       = $rows.Count
    plugins     = $rows.ToArray()
    disabled    = @($vbs | ForEach-Object { $_.FullName.Substring($PluginsDir.Length).TrimStart('\') })
}

$json = $result | ConvertTo-Json -Depth 6
if ($OutFile) {
    $dir = Split-Path $OutFile -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($OutFile, $json, [Text.UTF8Encoding]::new($false))
    # 输出小摘要给调用方
    @{ ok = $true; total = $rows.Count; bepinex = $bepVersion; out = $OutFile } | ConvertTo-Json -Compress
} else {
    $json
}
