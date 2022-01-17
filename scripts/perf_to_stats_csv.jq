#!/usr/bin/env -S jq -Mf -s -r

[ 
  .[] |
  select(has("stats")) |
  .stats |
  {
    sdkRevision: (.metadata.testData.sdkRevision | tostring), 
    sdkCommitTime: (.metadata.testData.sdkCommitTime | strftime("%Y-%m-%d %H:%M:%S")),
    success: (.duration != null),
    walletDeployDuration: .walletDeployDuration,
    loadgenDeployDuration: .loadgenDeployDuration,
    cycleAvgDuration: .cyclesSummary.avgDuration,
    cycleSuccessRate: .cyclesSummary.cycleSuccessRate,
  } + (.stages | with_entries(
    (.key | tonumber) as $stageIndex |
    ("stage" + .key + "_") as $stagePrefix |
    if ($stageIndex > 0 and $stageIndex < 5) then 
      { key: ($stagePrefix + "cycleAvgDuration"), value: .value.cyclesSummaries.all.avgDuration },
      { key: ($stagePrefix + "cycleSuccessRate"), value: .value.cyclesSummaries.all.cycleSuccessRate },
      { key: ($stagePrefix + "avgSwingsetBlockTime"), value: .value.blocksSummaries.onlyLive.avgSwingsetTime },
      empty
    else empty end
  ))
] |
sort_by(.sdkCommitTime) |
(
  map(keys_unsorted) | add |
  map({key: ., value: true}) | from_entries | keys_unsorted
) as $cols |
$cols, map(. as $row | $cols | map($row[.]))[] |
@csv