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

  "The child's own commits" are those after its merge base with the parent's tip *as it was
  before this script rebased the parent* (the force-push in step 3 moves `origin/<parent>` to
  rewritten commits, so `merge-base origin/<parent> origin/<child>` would fall back to `main`
  and replay the whole stack). The script therefore remembers every branch tip at start-up and
  computes each merge base from that snapshot.

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
  PR's branch still carries its parent's commits. The parent's tip from before the script
  rebased it is read from the PR's last force-push event (or its final head when it was never
  rebased), and the bottom PR is rebased first.
.PARAMETER UpstreamSha
  Recovery override: the commit up to which the bottom PR's history already landed on `main`
  (the parent's original tip). Use it when -RebaseOnto cannot work it out, for example from a
  stale local copy of the parent branch.
.PARAMETER RequireApproval
  Refuse to merge a PR whose review decision is not APPROVED.
.PARAMETER CheckTimeoutMinutes
  How long to wait for a PR's checks before giving up. Default 60.
.EXAMPLE
  .\scripts\land-stack.ps1 -Plan
  .\scripts\land-stack.ps1 -Simulate
  .\scripts\land-stack.ps1 -Bottom 22 -Top 27
  .\scripts\land-stack.ps1 -Bottom 25 -RebaseOnto 24
#>
[CmdletBinding()]
param(
  [int]$Bottom,
  [int]$Top,
  [switch]$Plan,
  [switch]$Simulate,
  [int]$RebaseOnto,
  [string]$UpstreamSha,
  [switch]$RequireApproval,
  [int]$CheckTimeoutMinutes = 60
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Step { param([string]$Text) Write-Host "[land] $Text" }

function Invoke-Retry {
  # Network calls to GitHub fail transiently; retry with a flat backoff before giving up.
  param([scriptblock]$Action, [string]$What, [int]$Attempts = 6)
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try { return & $Action }
    catch {
      if ($attempt -eq $Attempts) { throw }
      Write-Step "$What failed ($($_.Exception.Message.Split("`n")[0])); retry $attempt of $Attempts in 30 s"
      Start-Sleep -Seconds 30
    }
  }
}

function Invoke-Gh {
  param([string[]]$GhArgs, [switch]$NoRetry)
  $call = {
    $out = & gh @GhArgs
    if ($LASTEXITCODE -ne 0) { throw "gh $($GhArgs -join ' ') failed ($LASTEXITCODE)" }
    return $out
  }
  if ($NoRetry) { return & $call }
  return Invoke-Retry -Action $call -What "gh $($GhArgs[0..1] -join ' ')"
}

function Invoke-Git {
  param([string[]]$GitArgs, [switch]$AllowFailure)
  if ($AllowFailure) { $out = & git @GitArgs 2>$null } else { $out = & git @GitArgs }
  if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) { throw "git $($GitArgs -join ' ') failed ($LASTEXITCODE)" }
  return $out
}

function Invoke-Fetch {
  param([string[]]$Refspecs)
  $fetchArgs = @('fetch', '--quiet', '--prune', 'origin') + @($Refspecs | Where-Object { $_ })
  Invoke-Retry -What 'git fetch' -Action { Invoke-Git $fetchArgs | Out-Null }
}

$repo = (Invoke-Gh @('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner')).Trim()

# --- Chain discovery -------------------------------------------------------------------------
$open = Invoke-Gh @('pr', 'list', '--state', 'open', '--limit', '200', '--json',
  'number,title,headRefName,baseRefName,headRefOid,isDraft') | ConvertFrom-Json
foreach ($pr in $open) {
  # The tip before this run touches the branch; merge bases are computed from it, never from
  # `origin/<branch>`, which a rebase in this run moves to rewritten commits.
  $pr | Add-Member -NotePropertyName originalOid -NotePropertyValue $pr.headRefOid
}
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

Invoke-Fetch

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

function Get-UpstreamSha {
  # The commit up to which $Child's history belongs to $Parent: the merge base of the child's
  # branch with the parent's tip as it was when this run started.
  param([object]$Parent, [object]$Child)
  return (Invoke-Git @('merge-base', $Parent.originalOid, "origin/$($Child.headRefName)")).Trim()
}

function Get-MergedParentTip {
  # For -RebaseOnto: the tip of an already merged parent PR from before it was rebased by an
  # earlier run, so that the bottom PR's own commits can be told apart from the parent's.
  param([int]$Number, [string]$ChildRef)
  $query = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){' +
    'pullRequest(number:$number){state headRefOid timelineItems(itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT],last:1){' +
    'nodes{... on HeadRefForcePushedEvent{beforeCommit{oid}}}}}}}'
  $owner, $name = $repo -split '/'
  $info = Invoke-Gh @('api', 'graphql', '-f', "query=$query", '-F', "owner=$owner", '-F', "name=$name",
    '-F', "number=$Number", '--jq', '.data.repository.pullRequest') | ConvertFrom-Json
  if ($info.state -ne 'MERGED') { throw "#$Number is $($info.state), not merged; -RebaseOnto expects the landed parent." }
  # A candidate is right when the child shares history with it beyond what it shares with main;
  # the rebased tip of the parent only shares main's history with the child and is rejected.
  $mainBase = (Invoke-Git @('merge-base', 'origin/main', $ChildRef)).Trim()
  $candidates = @($info.headRefOid) + @($info.timelineItems.nodes | ForEach-Object { $_.beforeCommit.oid })
  foreach ($sha in $candidates) {
    if (-not $sha) { continue }
    Invoke-Git @('cat-file', '-e', "$sha^{commit}") -AllowFailure | Out-Null
    if ($LASTEXITCODE -ne 0) { Invoke-Fetch -Refspecs @($sha) }
    $base = (Invoke-Git @('merge-base', $sha, $ChildRef) -AllowFailure)
    if ($base -and $base.Trim() -ne $mainBase) { return $sha }
  }
  throw "Cannot tell where #$Number's history ends inside $ChildRef; rerun with -UpstreamSha <parent tip before its rebase>."
}

# Where the bottom PR's own commits start: main, unless an interrupted run left it carrying
# its already merged parent's commits.
$bottomUpstream = 'origin/main'
if ($UpstreamSha) { $bottomUpstream = $UpstreamSha }
elseif ($RebaseOnto) { $bottomUpstream = Get-MergedParentTip -Number $RebaseOnto -ChildRef "origin/$($chain[0].headRefName)" }
if ($bottomUpstream -ne 'origin/main') { Write-Step "#$($chain[0].number) own commits start after $($bottomUpstream.Substring(0, 10))" }

# --- Simulation ------------------------------------------------------------------------------
if ($Simulate) {
  $simBranch = 'land-stack-simulated-main'
  $simDir = "$scratch-main"
  try {
    Invoke-Git @('branch', '-D', $simBranch) -AllowFailure | Out-Null
    Invoke-Git @('worktree', 'add', '--quiet', '-b', $simBranch, $simDir, 'origin/main') | Out-Null
    $rows = @()
    for ($j = 0; $j -lt $chain.Count; $j++) {
      $pr = $chain[$j]
      $upstream = if ($j -eq 0) { $bottomUpstream } else { Get-UpstreamSha -Parent $chain[$j - 1] -Child $pr }
      $tip = Invoke-RebaseOnto -HeadRef "origin/$($pr.headRefName)" -UpstreamRef $upstream -OntoRef $simBranch
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
  $rerunAt = $null
  while ((Get-Date) -lt $deadline) {
    $raw = & gh pr checks $Number --json name,bucket,link 2>$null
    if ($LASTEXITCODE -ne 0 -and -not $raw) { Start-Sleep -Seconds 30; continue } # no checks reported yet
    $checks = @($raw | ConvertFrom-Json)
    $failed = @($checks | Where-Object { $_.bucket -in 'fail', 'cancel' })
    $pending = @($checks | Where-Object { $_.bucket -eq 'pending' })
    if ($failed.Count -gt 0) {
      $budgetRun = Get-BudgetRun -Failed $failed
      if ($budgetRun -and -not $rerunAt) {
        Write-Step "#$Number run $budgetRun never started (Actions budget); rerunning it once"
        Invoke-Gh @('run', 'rerun', '--failed', $budgetRun) | Out-Null
        $rerunAt = Get-Date
        Start-Sleep -Seconds 30
        continue
      }
      if ($budgetRun -and ((Get-Date) - $rerunAt).TotalMinutes -lt 3) { Start-Sleep -Seconds 20; continue } # GitHub still resetting the rerun jobs
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
  $branch = $Child.headRefName
  Invoke-Retry -What "git push $branch" -Action {
    # A push whose response was lost has already moved the remote; that counts as done.
    $remote = ((Invoke-Git @('ls-remote', 'origin', "refs/heads/$branch")) -split '\s+')[0]
    if ($remote -eq $tip) { return }
    Invoke-Git @('push', '--quiet', "--force-with-lease=refs/heads/${branch}:$($Child.headRefOid)",
      'origin', "${tip}:refs/heads/$branch") | Out-Null
  }
  $Child.headRefOid = $tip
  Start-Sleep -Seconds 20 # let GitHub register the new head before its checks are read
}

function Merge-Pr {
  param([object]$Pr)
  Invoke-Retry -What "merge #$($Pr.number)" -Action {
    $state = (Invoke-Gh @('pr', 'view', $Pr.number, '--json', 'state', '--jq', '.state') -NoRetry).Trim()
    if ($state -eq 'MERGED') { return }
    Invoke-Gh @('pr', 'merge', $Pr.number, '--squash', '--subject', "$($Pr.title) (#$($Pr.number))",
      '--match-head-commit', $Pr.headRefOid) -NoRetry | Out-Null
  }
}

function Remove-RemoteBranch {
  # The repository may delete head branches on merge by itself; a missing ref is not an error.
  param([string]$Name)
  & gh api -X DELETE "repos/$repo/git/refs/heads/$Name" 2>$null | Out-Null
}

try {
  if ($bottomUpstream -ne 'origin/main') { Push-Rebased -Child $chain[0] -UpstreamRef $bottomUpstream }

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
    # Read from the parent's original tip (not origin/<parent>, which this run may have rebased)
    # and before the parent's branch goes away.
    $upstreamSha = if ($child) { Get-UpstreamSha -Parent $pr -Child $child } else { $null }

    Write-Step "merging #$($pr.number): $($pr.title)"
    Merge-Pr -Pr $pr

    if ($child) {
      $childBase = (Invoke-Gh @('pr', 'view', $child.number, '--json', 'baseRefName', '--jq', '.baseRefName')).Trim()
      if ($childBase -ne 'main') { Invoke-Gh @('pr', 'edit', $child.number, '--base', 'main') | Out-Null }
      Remove-RemoteBranch -Name $pr.headRefName
      Invoke-Fetch
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
