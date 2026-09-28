<#
.SYNOPSIS
  Lands a stack of dependent pull requests bottom-up with squash merges.
.DESCRIPTION
  Muna's epics ship as stacked PRs (docs/11-ci-cd.md → Branching). A squash merge rewrites the
  parent's history, so once the parent lands the child still carries the parent's commits and
  GitHub shows them as conflicts. This script does, for every PR of the chain in order:

    1. wait for the checks on the PR's head (a job that never started because the GitHub
       Actions budget was exhausted is rerun once; any other failure stops the script),
    2. squash-merge with the PR title as the subject (`title (#N)`),
    3. retarget the child PR to `main`, delete the parent's branch, rebase only the child's own
       commits `--onto origin/main` in a scratch worktree and force-push it with a lease — the
       push starts the child's CI run, which step 1 then waits for.

  Nothing in your working tree is touched; local branches are left where they were (fetch and
  reset them afterwards). `-Simulate` replays the whole landing locally (rebase + squash) and
  reports whether every rebase is clean, without merging or pushing anything.
.PARAMETER Bottom
  Number of the first PR to land. Its base must be `main`. Default: the open PR on `main` that
  has a dependent PR.
.PARAMETER Top
  Stop after landing this PR. Default: the last PR of the chain.
.PARAMETER Plan
  Print the chain and exit.
.PARAMETER Simulate
  Local dry run in a scratch worktree; prints one row per PR and whether the rebase was clean.
.PARAMETER RebaseOnto
  Recovery after an interrupted run: the number of the already merged parent PR when the bottom
  PR's branch still carries its parent's commits. The script rebases the bottom PR first.
.PARAMETER RequireApproval
  Refuse to merge a PR whose review decision is not APPROVED.
.PARAMETER CheckTimeoutMinutes
  How long to wait for a PR's checks before giving up. Default 60.
.EXAMPLE
  .\scripts\land-stack.ps1 -Plan
  .\scripts\land-stack.ps1 -Simulate
  .\scripts\land-stack.ps1 -Bottom 22 -Top 27
#>
[CmdletBinding()]
param(
  [int]$Bottom,
  [int]$Top,
  [switch]$Plan,
  [switch]$Simulate,
  [int]$RebaseOnto,
  [switch]$RequireApproval,
  [int]$CheckTimeoutMinutes = 60
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Invoke-Gh {
  param([string[]]$GhArgs)
  $out = & gh @GhArgs
  if ($LASTEXITCODE -ne 0) { throw "gh $($GhArgs -join ' ') failed ($LASTEXITCODE)" }
  return $out
}

function Invoke-Git {
  param([string[]]$GitArgs, [switch]$AllowFailure)
  if ($AllowFailure) { $out = & git @GitArgs 2>$null } else { $out = & git @GitArgs }
  if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) { throw "git $($GitArgs -join ' ') failed ($LASTEXITCODE)" }
  return $out
}

function Write-Step { param([string]$Text) Write-Host "[land] $Text" }

$repo = (Invoke-Gh @('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner')).Trim()

# --- Chain discovery -------------------------------------------------------------------------
$open = Invoke-Gh @('pr', 'list', '--state', 'open', '--limit', '200', '--json',
  'number,title,headRefName,baseRefName,headRefOid,isDraft') | ConvertFrom-Json
$byBase = @{}
foreach ($pr in $open) {
  if (-not $byBase.ContainsKey($pr.baseRefName)) { $byBase[$pr.baseRefName] = @() }
  $byBase[$pr.baseRefName] += $pr
}
if (-not $Bottom) {
  $roots = @($byBase['main'] | Where-Object { $byBase.ContainsKey($_.headRefName) })
  if ($roots.Count -ne 1) {
    throw "Found $($roots.Count) PRs on main with a dependent PR; pass -Bottom explicitly."
  }
  $Bottom = $roots[0].number
}
$chain = @()
$current = $open | Where-Object { $_.number -eq $Bottom }
if (-not $current) { throw "PR #$Bottom is not open." }
if ($current.baseRefName -ne 'main') { throw "PR #$Bottom targets '$($current.baseRefName)', not main." }
while ($current) {
  $chain += $current
  if ($Top -and $current.number -eq $Top) { break }
  $children = @($byBase[$current.headRefName])
  if ($children.Count -gt 1) {
    throw "PR #$($current.number) has $($children.Count) dependent PRs ($($children.number -join ', ')); pass -Top to stop before it."
  }
  $current = if ($children.Count -eq 1) { $children[0] } else { $null }
}

Write-Step "chain of $($chain.Count) PRs on $repo, bottom-up:"
$i = 0
foreach ($pr in $chain) {
  $i++
  $draft = if ($pr.isDraft) { ' (draft)' } else { '' }
  Write-Host ("  {0,2}. #{1} {2} <- {3}{4}" -f $i, $pr.number, $pr.headRefName, $pr.baseRefName, $draft)
}
if ($Plan) { return }

Invoke-Git @('fetch', '--quiet', 'origin') | Out-Null

# --- Scratch worktree helpers ----------------------------------------------------------------
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("muna-land-" + [guid]::NewGuid().ToString('n').Substring(0, 8))
function Remove-Scratch {
  if (Test-Path $scratch) { Invoke-Git @('worktree', 'remove', '--force', $scratch) -AllowFailure | Out-Null }
  Invoke-Git @('worktree', 'prune') -AllowFailure | Out-Null
}

function Invoke-RebaseOnto {
  # Replays the commits of $HeadRef that are not in $UpstreamRef onto $OntoRef, in the scratch
  # worktree. Returns the rebased tip, or $null after aborting a conflicted rebase.
  param([string]$HeadRef, [string]$UpstreamRef, [string]$OntoRef)
  $mergeBase = (Invoke-Git @('merge-base', $UpstreamRef, $HeadRef)).Trim()
  Invoke-Git @('worktree', 'add', '--quiet', '--detach', $scratch, $HeadRef) | Out-Null
  & git -C $scratch rebase --quiet --onto $OntoRef $mergeBase 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $conflicted = & git -C $scratch diff --name-only --diff-filter=U
    & git -C $scratch rebase --abort 2>&1 | Out-Null
    Remove-Scratch
    Write-Warning "rebase of $HeadRef onto $OntoRef conflicts in: $($conflicted -join ', ')"
    return $null
  }
  $tip = (& git -C $scratch rev-parse HEAD).Trim()
  Remove-Scratch
  return $tip
}

# --- Simulation ------------------------------------------------------------------------------
if ($Simulate) {
  $simBranch = 'land-stack-simulated-main'
  $simDir = "$scratch-main"
  try {
    Invoke-Git @('branch', '-D', $simBranch) -AllowFailure | Out-Null
    Invoke-Git @('worktree', 'add', '--quiet', '-b', $simBranch, $simDir, 'origin/main') | Out-Null
    $rows = @()
    foreach ($pr in $chain) {
      $tip = Invoke-RebaseOnto -HeadRef "origin/$($pr.headRefName)" -UpstreamRef "origin/$($pr.baseRefName)" -OntoRef $simBranch
      if (-not $tip) {
        $rows += [pscustomobject]@{ pr = $pr.number; head = $pr.headRefName; commits = '-'; rebase = 'CONFLICT' }
        break
      }
      $count = (Invoke-Git @('rev-list', '--count', "$simBranch..$tip")).Trim()
      & git -C $simDir merge --squash --quiet $tip 2>&1 | Out-Null
      & git -C $simDir commit --quiet --no-verify -m "$($pr.title) (#$($pr.number))" 2>&1 | Out-Null
      $rows += [pscustomobject]@{ pr = $pr.number; head = $pr.headRefName; commits = $count; rebase = 'clean' }
    }
    $rows | Format-Table -AutoSize | Out-Host
    $last = $chain[$rows.Count - 1]
    $same = (Invoke-Git @('rev-parse', "$simBranch^{tree}")).Trim() -eq (Invoke-Git @('rev-parse', "origin/$($last.headRefName)^{tree}")).Trim()
    Write-Step "simulated main matches the tree of #$($last.number): $same"
    if ($rows.rebase -contains 'CONFLICT' -or -not $same) { exit 1 }
  }
  finally {
    if (Test-Path $simDir) { Invoke-Git @('worktree', 'remove', '--force', $simDir) -AllowFailure | Out-Null }
    Invoke-Git @('branch', '-D', $simBranch) -AllowFailure | Out-Null
    Invoke-Git @('worktree', 'prune') -AllowFailure | Out-Null
  }
  return
}

# --- Checks ----------------------------------------------------------------------------------
function Get-BudgetRun {
  # Returns the run id when a failed check never started because of the Actions budget.
  param([object[]]$Failed)
  foreach ($check in $Failed) {
    if ($check.link -notmatch '/actions/runs/(\d+)/job/(\d+)') { continue }
    $runId = $Matches[1]; $jobId = $Matches[2]
    $messages = Invoke-Gh @('api', "repos/$repo/check-runs/$jobId/annotations", '--jq', '.[].message')
    if (($messages -join ' ') -match 'Actions budget') { return $runId }
  }
  return $null
}

function Wait-Checks {
  param([int]$Number)
  $deadline = (Get-Date).AddMinutes($CheckTimeoutMinutes)
  $rerunDone = $false
  while ((Get-Date) -lt $deadline) {
    $raw = & gh pr checks $Number --json name,bucket,link 2>$null
    if ($LASTEXITCODE -ne 0 -and -not $raw) { Start-Sleep -Seconds 30; continue } # no checks reported yet
    $checks = @($raw | ConvertFrom-Json)
    $failed = @($checks | Where-Object { $_.bucket -in 'fail', 'cancel' })
    $pending = @($checks | Where-Object { $_.bucket -eq 'pending' })
    if ($failed.Count -gt 0) {
      $budgetRun = Get-BudgetRun -Failed $failed
      if ($budgetRun -and -not $rerunDone) {
        Write-Step "#$Number run $budgetRun never started (Actions budget); rerunning it once"
        Invoke-Gh @('run', 'rerun', '--failed', $budgetRun) | Out-Null
        $rerunDone = $true
        Start-Sleep -Seconds 60
        continue
      }
      if ($budgetRun) {
        throw "The GitHub Actions budget is still exhausted. Raise it (Settings > Billing > Budgets and alerts) or wait for the billing cycle, then rerun with -Bottom $Number."
      }
      throw "Checks failed on #${Number}: $(($failed | ForEach-Object { "$($_.name) $($_.link)" }) -join '; ')"
    }
    if ($pending.Count -eq 0 -and $checks.Count -gt 0) { return }
    Write-Step "#$Number waiting for $($pending.Count) checks"
    & gh pr checks $Number --watch --fail-fast 2>$null | Out-Null
  }
  throw "Timed out waiting for the checks on #$Number."
}

function Wait-Mergeable {
  param([int]$Number)
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $state = (Invoke-Gh @('pr', 'view', $Number, '--json', 'mergeable', '--jq', '.mergeable')).Trim()
    if ($state -eq 'MERGEABLE') { return }
    if ($state -eq 'CONFLICTING') { throw "#$Number has conflicts with main; rebase it and rerun." }
    Start-Sleep -Seconds 15
  }
  throw "GitHub did not compute mergeability for #$Number."
}

# --- Landing ---------------------------------------------------------------------------------
function Push-Rebased {
  param([object]$Child, [string]$UpstreamRef)
  Write-Step "rebasing #$($Child.number) $($Child.headRefName) onto origin/main"
  $tip = Invoke-RebaseOnto -HeadRef "origin/$($Child.headRefName)" -UpstreamRef $UpstreamRef -OntoRef 'origin/main'
  if (-not $tip) { throw "Resolve the conflicts on $($Child.headRefName) by hand, push, then rerun with -Bottom $($Child.number)." }
  Invoke-Git @('push', '--quiet', "--force-with-lease=refs/heads/$($Child.headRefName):$($Child.headRefOid)",
    'origin', "${tip}:refs/heads/$($Child.headRefName)") | Out-Null
  $Child.headRefOid = $tip
  Start-Sleep -Seconds 20 # let GitHub register the new head before its checks are read
}

function Remove-RemoteBranch {
  # The repository may delete head branches on merge by itself; a missing ref is not an error.
  param([string]$Name)
  & gh api -X DELETE "repos/$repo/git/refs/heads/$Name" 2>$null | Out-Null
}

try {
  if ($RebaseOnto) {
    Invoke-Git @('fetch', '--quiet', 'origin', "+refs/pull/$RebaseOnto/head:refs/remotes/origin/land-stack-parent") | Out-Null
    Invoke-Git @('fetch', '--quiet', 'origin', 'main') | Out-Null
    Push-Rebased -Child $chain[0] -UpstreamRef 'origin/land-stack-parent'
    Invoke-Git @('update-ref', '-d', 'refs/remotes/origin/land-stack-parent') -AllowFailure | Out-Null
  }

  for ($index = 0; $index -lt $chain.Count; $index++) {
    $pr = $chain[$index]
    $child = if ($index + 1 -lt $chain.Count) { $chain[$index + 1] } else { $null }
    if ($pr.isDraft) { throw "#$($pr.number) is a draft; mark it ready first." }
    if ($RequireApproval) {
      $decision = (Invoke-Gh @('pr', 'view', $pr.number, '--json', 'reviewDecision', '--jq', '.reviewDecision')).Trim()
      if ($decision -ne 'APPROVED') { throw "#$($pr.number) is not approved ($decision)." }
    }

    Wait-Checks -Number $pr.number
    Wait-Mergeable -Number $pr.number
    # The child's merge base with its parent must be read before the parent's branch goes away.
    $upstreamSha = if ($child) { (Invoke-Git @('merge-base', "origin/$($pr.headRefName)", "origin/$($child.headRefName)")).Trim() } else { $null }

    Write-Step "merging #$($pr.number): $($pr.title)"
    Invoke-Gh @('pr', 'merge', $pr.number, '--squash', '--subject', "$($pr.title) (#$($pr.number))",
      '--match-head-commit', $pr.headRefOid) | Out-Null

    if ($child) {
      $childBase = (Invoke-Gh @('pr', 'view', $child.number, '--json', 'baseRefName', '--jq', '.baseRefName')).Trim()
      if ($childBase -ne 'main') { Invoke-Gh @('pr', 'edit', $child.number, '--base', 'main') | Out-Null }
      Remove-RemoteBranch -Name $pr.headRefName
      Invoke-Git @('fetch', '--quiet', '--prune', 'origin') | Out-Null
      Push-Rebased -Child $child -UpstreamRef $upstreamSha
    }
    else {
      Remove-RemoteBranch -Name $pr.headRefName
    }
  }
  Write-Step "landed $($chain.Count) PRs; run 'git fetch --prune' and reset any stale local branches."
}
finally {
  Remove-Scratch
}
