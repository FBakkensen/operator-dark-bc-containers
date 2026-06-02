param(
    [string] $Operation = 'refresh',
    [string] $Action,
    [string] $ContainerName,
    [string] $BcContainersFixturePath,
    [string] $DockerInspectFixturePath,
    [string] $DockerStatsFixturePath,
    [string] $FailureFixturePath,
    [string] $ActionResultFixturePath
)

$ErrorActionPreference = 'Stop'

function New-Timestamp {
    return [DateTimeOffset]::Now.ToString('o')
}

function Read-JsonFile {
    param([string] $Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Fixture not found: $Path"
    }

    $Raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($Raw)) {
        return $null
    }

    return ($Raw | ConvertFrom-Json)
}

function ConvertTo-ObjectArray {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [System.Array]) {
        return @($Value)
    }

    return @($Value)
}

function Get-PropertyValue {
    param(
        $InputObject,
        [string[]] $Names
    )

    if ($null -eq $InputObject) {
        return $null
    }

    foreach ($Name in $Names) {
        $Property = $InputObject.PSObject.Properties[$Name]
        if ($null -ne $Property) {
            return $Property.Value
        }
    }

    return $null
}

function New-ProtocolError {
    param(
        [string] $OperationName,
        $Command,
        [Nullable[int]] $ExitCode,
        [string] $Stderr
    )

    return [ordered]@{
        operation = $OperationName
        command = $Command
        exitCode = $ExitCode
        stderr = $Stderr
    }
}

function Split-CommandOutput {
    param([array] $Output)

    $StdoutItems = @()
    $DiagnosticItems = @()

    foreach ($Item in @($Output)) {
        if ($Item -is [System.Management.Automation.ErrorRecord]) {
            $DiagnosticItems += $Item.ToString()
        } else {
            $StdoutItems += $Item
        }
    }

    return [ordered]@{
        stdout = $StdoutItems
        diagnostics = $DiagnosticItems
    }
}

function New-RefreshFailure {
    param($ErrorInfo)

    return [ordered]@{
        ok = $false
        refreshedAt = New-Timestamp
        summary = [ordered]@{
            total = 0
            running = 0
            cpuPercent = 0
            memoryBytes = 0
            hostCpuCount = [Environment]::ProcessorCount
        }
        containers = @()
        error = $ErrorInfo
    }
}

function New-RefreshSuccess {
    param(
        [array] $Containers,
        [double] $CpuPercent,
        [Int64] $MemoryBytes
    )

    $Running = @($Containers | Where-Object { $_.state -eq 'running' })

    return [ordered]@{
        ok = $true
        refreshedAt = New-Timestamp
        summary = [ordered]@{
            total = @($Containers).Count
            running = @($Running).Count
            cpuPercent = [Math]::Round($CpuPercent, 2)
            memoryBytes = $MemoryBytes
            hostCpuCount = [Environment]::ProcessorCount
        }
        containers = @($Containers)
        error = $null
    }
}

function Get-FailureFixture {
    param([string] $ExpectedOperation)

    $Failure = Read-JsonFile -Path $FailureFixturePath
    if ($null -eq $Failure) {
        return $null
    }

    $OperationName = [string] (Get-PropertyValue -InputObject $Failure -Names @('operation', 'Operation'))
    if ($OperationName -ne $ExpectedOperation) {
        return $null
    }

    return New-ProtocolError `
        -OperationName $OperationName `
        -Command ([string] (Get-PropertyValue -InputObject $Failure -Names @('command', 'Command'))) `
        -ExitCode (Get-PropertyValue -InputObject $Failure -Names @('exitCode', 'ExitCode')) `
        -Stderr ([string] (Get-PropertyValue -InputObject $Failure -Names @('stderr', 'Stderr', 'error', 'Error')))
}

function Import-BcContainerHelperQuietly {
    param([string] $OperationName)

    try {
        Import-Module -Name 'BcContainerHelper' -ErrorAction Stop *> $null
        return [ordered]@{ ok = $true; error = $null }
    } catch {
        $ErrorInfo = New-ProtocolError `
            -OperationName $OperationName `
            -Command 'Import-Module BcContainerHelper' `
            -ExitCode $null `
            -Stderr $_.Exception.Message
        return [ordered]@{ ok = $false; error = $ErrorInfo }
    }
}

function ConvertTo-BcContainerIdentity {
    param($Item)

    if ($Item -is [string]) {
        $Name = $Item
    } else {
        $Name = Get-PropertyValue -InputObject $Item -Names @('name', 'Name', 'containerName', 'ContainerName')
    }

    if ([string]::IsNullOrWhiteSpace($Name)) {
        throw 'BCContainerHelper returned a container without a name.'
    }

    return [ordered]@{
        name = [string] $Name
    }
}

function Get-BcContainerIdentities {
    $Failure = Get-FailureFixture -ExpectedOperation 'Get-BcContainers'
    if ($null -ne $Failure) {
        return [ordered]@{ ok = $false; error = $Failure; value = @() }
    }

    if (-not [string]::IsNullOrWhiteSpace($BcContainersFixturePath)) {
        $RawContainers = ConvertTo-ObjectArray -Value (Read-JsonFile -Path $BcContainersFixturePath)
    } else {
        $ImportResult = Import-BcContainerHelperQuietly -OperationName 'Get-BcContainers'
        if (-not $ImportResult.ok) {
            return [ordered]@{ ok = $false; error = $ImportResult.error; value = @() }
        }

        $Command = Get-Command -Name 'Get-BcContainers' -ErrorAction SilentlyContinue
        if ($null -eq $Command) {
            $ErrorInfo = New-ProtocolError `
                -OperationName 'Get-BcContainers' `
                -Command 'Get-BcContainers' `
                -ExitCode $null `
                -Stderr "Get-BcContainers was not found. Install or import BCContainerHelper before refreshing BC containers."
            return [ordered]@{ ok = $false; error = $ErrorInfo; value = @() }
        }

        try {
            $Output = & Get-BcContainers *>&1
            $Streams = Split-CommandOutput -Output $Output
            if (@($Streams.diagnostics).Count -gt 0) {
                $ErrorInfo = New-ProtocolError `
                    -OperationName 'Get-BcContainers' `
                    -Command 'Get-BcContainers' `
                    -ExitCode $null `
                    -Stderr (@($Streams.diagnostics) -join [Environment]::NewLine)
                return [ordered]@{ ok = $false; error = $ErrorInfo; value = @() }
            }

            $RawContainers = @($Streams.stdout)
        } catch {
            $ErrorInfo = New-ProtocolError `
                -OperationName 'Get-BcContainers' `
                -Command 'Get-BcContainers' `
                -ExitCode $null `
                -Stderr $_.Exception.Message
            return [ordered]@{ ok = $false; error = $ErrorInfo; value = @() }
        }
    }

    $Identities = @()
    foreach ($RawContainer in $RawContainers) {
        $Identities += ConvertTo-BcContainerIdentity -Item $RawContainer
    }

    return [ordered]@{ ok = $true; error = $null; value = $Identities }
}

function Get-DockerName {
    param($InspectEntry)

    $Name = [string] (Get-PropertyValue -InputObject $InspectEntry -Names @('Name', 'name'))
    if ($Name.StartsWith('/')) {
        return $Name.Substring(1)
    }

    return $Name
}

function Invoke-DockerInspect {
    param([string[]] $Names)

    if (@($Names).Count -eq 0) {
        return [ordered]@{ ok = $true; error = $null; value = @() }
    }

    $Failure = Get-FailureFixture -ExpectedOperation 'docker inspect'
    if ($null -ne $Failure) {
        return [ordered]@{ ok = $false; error = $Failure; value = @() }
    }

    if (-not [string]::IsNullOrWhiteSpace($DockerInspectFixturePath)) {
        return [ordered]@{ ok = $true; error = $null; value = (ConvertTo-ObjectArray -Value (Read-JsonFile -Path $DockerInspectFixturePath)) }
    }

    $Command = Get-Command -Name 'docker' -ErrorAction SilentlyContinue
    $CommandText = "docker inspect $($Names -join ' ')"
    if ($null -eq $Command) {
        $ErrorInfo = New-ProtocolError `
            -OperationName 'docker inspect' `
            -Command $CommandText `
            -ExitCode $null `
            -Stderr 'docker was not found on PATH.'
        return [ordered]@{ ok = $false; error = $ErrorInfo; value = @() }
    }

    $Output = & docker inspect @Names *>&1
    $ExitCode = $LASTEXITCODE
    $Streams = Split-CommandOutput -Output $Output
    if ($ExitCode -ne 0 -or @($Streams.diagnostics).Count -gt 0) {
        $ErrorText = (@($Output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine)
        $ErrorInfo = New-ProtocolError `
            -OperationName 'docker inspect' `
            -Command $CommandText `
            -ExitCode $ExitCode `
            -Stderr $ErrorText
        return [ordered]@{ ok = $false; error = $ErrorInfo; value = @() }
    }

    $Json = (@($Streams.stdout | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine)
    return [ordered]@{ ok = $true; error = $null; value = (ConvertTo-ObjectArray -Value ($Json | ConvertFrom-Json)) }
}

function Invoke-DockerStats {
    param([string[]] $Names)

    if (@($Names).Count -eq 0) {
        return [ordered]@{ ok = $true; error = $null; value = @() }
    }

    $Failure = Get-FailureFixture -ExpectedOperation 'docker stats'
    if ($null -ne $Failure) {
        return [ordered]@{ ok = $false; error = $Failure; value = @() }
    }

    if (-not [string]::IsNullOrWhiteSpace($DockerStatsFixturePath)) {
        return [ordered]@{ ok = $true; error = $null; value = (ConvertTo-ObjectArray -Value (Read-JsonFile -Path $DockerStatsFixturePath)) }
    }

    $Command = Get-Command -Name 'docker' -ErrorAction SilentlyContinue
    $CommandText = "docker stats --no-stream --format {{json .}} $($Names -join ' ')"
    if ($null -eq $Command) {
        $ErrorInfo = New-ProtocolError `
            -OperationName 'docker stats' `
            -Command $CommandText `
            -ExitCode $null `
            -Stderr 'docker was not found on PATH.'
        return [ordered]@{ ok = $false; error = $ErrorInfo; value = @() }
    }

    $Arguments = @('stats', '--no-stream', '--format', '{{json .}}') + @($Names)
    $Output = & docker @Arguments *>&1
    $ExitCode = $LASTEXITCODE
    $Streams = Split-CommandOutput -Output $Output
    if ($ExitCode -ne 0 -or @($Streams.diagnostics).Count -gt 0) {
        $ErrorText = (@($Output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine)
        $ErrorInfo = New-ProtocolError `
            -OperationName 'docker stats' `
            -Command $CommandText `
            -ExitCode $ExitCode `
            -Stderr $ErrorText
        return [ordered]@{ ok = $false; error = $ErrorInfo; value = @() }
    }

    $Stats = @()
    foreach ($Line in @($Streams.stdout | ForEach-Object { $_.ToString() })) {
        if (-not [string]::IsNullOrWhiteSpace($Line)) {
            $Stats += ($Line | ConvertFrom-Json)
        }
    }

    return [ordered]@{ ok = $true; error = $null; value = $Stats }
}

function ConvertTo-Percent {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
        return [double] $Value
    }

    $Text = ([string] $Value).Trim().TrimEnd('%').Replace(',', '.')
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    return [double]::Parse($Text, [Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-Bytes {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [int] -or $Value -is [long]) {
        return [Int64] $Value
    }

    $Text = ([string] $Value).Trim()
    if ($Text.Contains('/')) {
        $Text = $Text.Split('/')[0].Trim()
    }

    $Match = [regex]::Match($Text, '^([0-9]+(?:[\.,][0-9]+)?)\s*([KMGT]?i?B|B)$', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $Match.Success) {
        return $null
    }

    $Number = [double]::Parse($Match.Groups[1].Value.Replace(',', '.'), [Globalization.CultureInfo]::InvariantCulture)
    $Unit = $Match.Groups[2].Value.ToUpperInvariant()
    $Multiplier = switch ($Unit) {
        'B' { 1; break }
        'KB' { 1000; break }
        'MB' { 1000000; break }
        'GB' { 1000000000; break }
        'TB' { 1000000000000; break }
        'KIB' { 1024; break }
        'MIB' { 1048576; break }
        'GIB' { 1073741824; break }
        'TIB' { 1099511627776; break }
        default { 1; break }
    }

    return [Int64] [Math]::Round($Number * $Multiplier)
}

function Normalize-Health {
    param(
        [string] $Health,
        [string] $State
    )

    $Candidate = $Health
    if ([string]::IsNullOrWhiteSpace($Candidate)) {
        $Candidate = $State
    }

    if ([string]::IsNullOrWhiteSpace($Candidate)) {
        return 'unknown'
    }

    $Normalized = $Candidate.ToLowerInvariant()
    $Allowed = @('healthy', 'unhealthy', 'starting', 'running', 'exited')
    if ($Allowed -contains $Normalized) {
        return $Normalized
    }

    return $Normalized
}

function Get-DockerState {
    param($InspectEntry)

    $StateObject = Get-PropertyValue -InputObject $InspectEntry -Names @('State', 'state')
    $Status = Get-PropertyValue -InputObject $StateObject -Names @('Status', 'status')
    if ([string]::IsNullOrWhiteSpace($Status)) {
        return 'unknown'
    }

    return ([string] $Status).ToLowerInvariant()
}

function Test-ContainerRunning {
    param($InspectEntry)

    $StateObject = Get-PropertyValue -InputObject $InspectEntry -Names @('State', 'state')
    $Running = Get-PropertyValue -InputObject $StateObject -Names @('Running', 'running')
    if ($Running -is [bool]) {
        return $Running
    }

    return (Get-DockerState -InspectEntry $InspectEntry) -eq 'running'
}

function Get-InspectStatus {
    param($InspectEntry)

    $StateObject = Get-PropertyValue -InputObject $InspectEntry -Names @('State', 'state')
    $Status = Get-PropertyValue -InputObject $StateObject -Names @('Status', 'status')
    if ([string]::IsNullOrWhiteSpace($Status)) {
        return 'unknown'
    }

    return [string] $Status
}

function Get-InspectHealth {
    param($InspectEntry)

    $StateObject = Get-PropertyValue -InputObject $InspectEntry -Names @('State', 'state')
    $HealthObject = Get-PropertyValue -InputObject $StateObject -Names @('Health', 'health')
    return Get-PropertyValue -InputObject $HealthObject -Names @('Status', 'status')
}

function Get-InspectImage {
    param($InspectEntry)

    $Config = Get-PropertyValue -InputObject $InspectEntry -Names @('Config', 'config')
    $Image = Get-PropertyValue -InputObject $Config -Names @('Image', 'image')
    if ([string]::IsNullOrWhiteSpace($Image)) {
        $Image = Get-PropertyValue -InputObject $InspectEntry -Names @('ImageName', 'imageName')
    }

    return $Image
}

function Get-StatName {
    param($StatEntry)

    return [string] (Get-PropertyValue -InputObject $StatEntry -Names @('Name', 'name', 'Container', 'container'))
}

function Invoke-RefreshOperation {
    $BcResult = Get-BcContainerIdentities
    if (-not $BcResult.ok) {
        return New-RefreshFailure -ErrorInfo $BcResult.error
    }

    $Identities = @($BcResult.value)
    $Names = @($Identities | ForEach-Object { $_.name })

    $InspectResult = Invoke-DockerInspect -Names $Names
    if (-not $InspectResult.ok) {
        return New-RefreshFailure -ErrorInfo $InspectResult.error
    }

    $InspectByName = @{}
    foreach ($InspectEntry in @($InspectResult.value)) {
        $DockerName = Get-DockerName -InspectEntry $InspectEntry
        if (-not [string]::IsNullOrWhiteSpace($DockerName)) {
            $InspectByName[$DockerName] = $InspectEntry
        }
    }

    $RunningNames = @()
    foreach ($Name in $Names) {
        if ($InspectByName.ContainsKey($Name) -and (Test-ContainerRunning -InspectEntry $InspectByName[$Name])) {
            $RunningNames += $Name
        }
    }

    $StatsResult = Invoke-DockerStats -Names $RunningNames
    if (-not $StatsResult.ok) {
        return New-RefreshFailure -ErrorInfo $StatsResult.error
    }

    $StatsByName = @{}
    foreach ($StatEntry in @($StatsResult.value)) {
        $StatName = Get-StatName -StatEntry $StatEntry
        if (-not [string]::IsNullOrWhiteSpace($StatName)) {
            $StatsByName[$StatName] = $StatEntry
        }
    }

    $Containers = @()
    $TotalCpu = [double] 0
    $TotalMemory = [Int64] 0

    foreach ($Identity in $Identities) {
        $Name = $Identity.name
        $InspectEntry = $null
        if ($InspectByName.ContainsKey($Name)) {
            $InspectEntry = $InspectByName[$Name]
        }

        $State = Get-DockerState -InspectEntry $InspectEntry
        $Health = Normalize-Health -Health (Get-InspectHealth -InspectEntry $InspectEntry) -State $State
        $Status = Get-InspectStatus -InspectEntry $InspectEntry
        $IsRunning = $State -eq 'running'

        $Container = [ordered]@{
            name = $Name
            state = $State
            health = $Health
            status = $Status
            cpuPercent = $null
            memoryBytes = $null
            image = Get-InspectImage -InspectEntry $InspectEntry
        }

        if ($IsRunning -and $StatsByName.ContainsKey($Name)) {
            $StatEntry = $StatsByName[$Name]
            $Cpu = ConvertTo-Percent -Value (Get-PropertyValue -InputObject $StatEntry -Names @('cpuPercent', 'CPUPercent', 'CPUPerc', 'CPUPerc'))
            $Memory = ConvertTo-Bytes -Value (Get-PropertyValue -InputObject $StatEntry -Names @('memoryBytes', 'MemoryBytes', 'MemUsage', 'memUsage'))
            $Container.cpuPercent = $Cpu
            $Container.memoryBytes = $Memory

            if ($null -ne $Cpu) {
                $TotalCpu += $Cpu
            }

            if ($null -ne $Memory) {
                $TotalMemory += $Memory
            }
        }

        $Containers += $Container
    }

    return New-RefreshSuccess -Containers $Containers -CpuPercent $TotalCpu -MemoryBytes $TotalMemory
}

function New-ActionResponse {
    param(
        [bool] $Ok,
        [string] $ActionName,
        [string] $TargetContainer,
        $Command,
        [string[]] $Arguments,
        [string] $StartedAt,
        [string] $FinishedAt,
        [Nullable[int]] $ExitCode,
        [string] $Stdout,
        [string] $Stderr,
        $ErrorInfo = $null
    )

    return [ordered]@{
        ok = $Ok
        action = $ActionName
        container = $TargetContainer
        command = $Command
        arguments = @($Arguments)
        startedAt = $StartedAt
        finishedAt = $FinishedAt
        exitCode = $ExitCode
        stdout = $Stdout
        stderr = $Stderr
        error = $ErrorInfo
    }
}

function Invoke-ActionOperation {
    $StartedAt = New-Timestamp
    $NormalizedAction = ''
    if (-not [string]::IsNullOrWhiteSpace($Action)) {
        $NormalizedAction = $Action.ToLowerInvariant()
    }

    $ActionCommands = @{
        start = 'Start-BcContainer'
        stop = 'Stop-BcContainer'
        restart = 'Restart-BcContainer'
        remove = 'Remove-BcContainer'
    }

    if (-not $ActionCommands.ContainsKey($NormalizedAction)) {
        $Stderr = "Unsupported lifecycle action: $Action"
        $ErrorInfo = New-ProtocolError -OperationName 'ValidateAction' -Command $null -ExitCode $null -Stderr $Stderr
        return New-ActionResponse `
            -Ok $false `
            -ActionName $Action `
            -TargetContainer $ContainerName `
            -Command $null `
            -Arguments @() `
            -StartedAt $StartedAt `
            -FinishedAt (New-Timestamp) `
            -ExitCode $null `
            -Stdout '' `
            -Stderr $Stderr `
            -ErrorInfo $ErrorInfo
    }

    if ([string]::IsNullOrWhiteSpace($ContainerName)) {
        $Stderr = 'Container name is required.'
        $ErrorInfo = New-ProtocolError -OperationName 'ValidateContainer' -Command $null -ExitCode $null -Stderr $Stderr
        return New-ActionResponse `
            -Ok $false `
            -ActionName $NormalizedAction `
            -TargetContainer $ContainerName `
            -Command $null `
            -Arguments @() `
            -StartedAt $StartedAt `
            -FinishedAt (New-Timestamp) `
            -ExitCode $null `
            -Stdout '' `
            -Stderr $Stderr `
            -ErrorInfo $ErrorInfo
    }

    $CommandName = $ActionCommands[$NormalizedAction]
    $CommandText = "$CommandName $ContainerName"
    $Arguments = @($ContainerName)

    if (-not [string]::IsNullOrWhiteSpace($ActionResultFixturePath)) {
        $Fixture = Read-JsonFile -Path $ActionResultFixturePath
        $ExitCode = [int] (Get-PropertyValue -InputObject $Fixture -Names @('exitCode', 'ExitCode'))
        $Stdout = [string] (Get-PropertyValue -InputObject $Fixture -Names @('stdout', 'Stdout'))
        $Stderr = [string] (Get-PropertyValue -InputObject $Fixture -Names @('stderr', 'Stderr', 'error', 'Error'))
        $ErrorInfo = $null
        if ($ExitCode -ne 0) {
            $ErrorInfo = New-ProtocolError -OperationName $CommandName -Command $CommandText -ExitCode $ExitCode -Stderr $Stderr
        }

        return New-ActionResponse `
            -Ok ($ExitCode -eq 0) `
            -ActionName $NormalizedAction `
            -TargetContainer $ContainerName `
            -Command $CommandText `
            -Arguments $Arguments `
            -StartedAt $StartedAt `
            -FinishedAt (New-Timestamp) `
            -ExitCode $ExitCode `
            -Stdout $Stdout `
            -Stderr $Stderr `
            -ErrorInfo $ErrorInfo
    }

    $ImportResult = Import-BcContainerHelperQuietly -OperationName $CommandName
    if (-not $ImportResult.ok) {
        return New-ActionResponse `
            -Ok $false `
            -ActionName $NormalizedAction `
            -TargetContainer $ContainerName `
            -Command $CommandText `
            -Arguments $Arguments `
            -StartedAt $StartedAt `
            -FinishedAt (New-Timestamp) `
            -ExitCode $null `
            -Stdout '' `
            -Stderr $ImportResult.error.stderr `
            -ErrorInfo $ImportResult.error
    }

    $Command = Get-Command -Name $CommandName -ErrorAction SilentlyContinue
    if ($null -eq $Command) {
        $Stderr = "$CommandName was not found. Install or import BCContainerHelper before running lifecycle actions."
        $ErrorInfo = New-ProtocolError -OperationName $CommandName -Command $CommandText -ExitCode $null -Stderr $Stderr
        return New-ActionResponse `
            -Ok $false `
            -ActionName $NormalizedAction `
            -TargetContainer $ContainerName `
            -Command $CommandText `
            -Arguments $Arguments `
            -StartedAt $StartedAt `
            -FinishedAt (New-Timestamp) `
            -ExitCode $null `
            -Stdout '' `
            -Stderr $Stderr `
            -ErrorInfo $ErrorInfo
    }

    try {
        $Output = & $CommandName $ContainerName *>&1
        $Streams = Split-CommandOutput -Output $Output
        $Stderr = (@($Streams.diagnostics) -join [Environment]::NewLine)
        $Stdout = (@($Streams.stdout | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine)
        $ExitCode = 0
        if (-not [string]::IsNullOrWhiteSpace($Stderr)) {
            $ExitCode = 1
        }

        $ErrorInfo = $null
        if ($ExitCode -ne 0) {
            $ErrorInfo = New-ProtocolError -OperationName $CommandName -Command $CommandText -ExitCode $ExitCode -Stderr $Stderr
        }

        return New-ActionResponse `
            -Ok ($ExitCode -eq 0) `
            -ActionName $NormalizedAction `
            -TargetContainer $ContainerName `
            -Command $CommandText `
            -Arguments $Arguments `
            -StartedAt $StartedAt `
            -FinishedAt (New-Timestamp) `
            -ExitCode $ExitCode `
            -Stdout $Stdout `
            -Stderr $Stderr `
            -ErrorInfo $ErrorInfo
    } catch {
        $Stderr = $_.Exception.Message
        $ErrorInfo = New-ProtocolError -OperationName $CommandName -Command $CommandText -ExitCode 1 -Stderr $Stderr
        return New-ActionResponse `
            -Ok $false `
            -ActionName $NormalizedAction `
            -TargetContainer $ContainerName `
            -Command $CommandText `
            -Arguments $Arguments `
            -StartedAt $StartedAt `
            -FinishedAt (New-Timestamp) `
            -ExitCode 1 `
            -Stdout '' `
            -Stderr $Stderr `
            -ErrorInfo $ErrorInfo
    }
}

function Write-ProtocolJson {
    param($Payload)

    [Console]::Out.WriteLine(($Payload | ConvertTo-Json -Depth 20 -Compress))
}

try {
    $NormalizedOperation = ''
    if (-not [string]::IsNullOrWhiteSpace($Operation)) {
        $NormalizedOperation = $Operation.ToLowerInvariant()
    }

    if ($NormalizedOperation -eq 'refresh') {
        $Payload = Invoke-RefreshOperation
    } elseif ($NormalizedOperation -eq 'action') {
        $Payload = Invoke-ActionOperation
    } else {
        $ErrorInfo = New-ProtocolError -OperationName 'ValidateOperation' -Command $Operation -ExitCode $null -Stderr "Unsupported helper operation: $Operation"
        $Payload = New-RefreshFailure -ErrorInfo $ErrorInfo
    }
} catch {
    $ErrorInfo = New-ProtocolError -OperationName 'UnhandledHelperError' -Command $Operation -ExitCode $null -Stderr $_.Exception.Message
    $Payload = New-RefreshFailure -ErrorInfo $ErrorInfo
}

Write-ProtocolJson -Payload $Payload
exit 0
