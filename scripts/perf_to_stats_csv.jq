#!/usr/bin/env -S jq -Mf -s -r

[ 
  .[] |
  select(has("stats")) |
  .stats |
  {
    sdkRevision: (.metadata.testData.sdkRevision // "" | tostring), 
    sdkCommitTime: (.metadata.testData.sdkCommitTime | strftime("%Y-%m-%d %H:%M:%S")? // ""),
    success: (.duration != null),
    chainBootstrapDuration: (.chainBootstrapDuration // .stages["0"].chainInitDuration),
    walletDeployDuration: .walletDeployDuration,
    loadgenDeployDuration: .loadgenDeployDuration,
    cycleSuccessRate: .cyclesSummary.cycleSuccessRate,
    cycleAvgDuration: .cyclesSummary.avgDuration,
  } + (.stages | with_entries(
    .value.stageConfig as $stageConfig |
    ("stage" + .key + "_") as $stagePrefix |
    if ($stageConfig["chainOnly"] != true and $stageConfig["durationConfig"] != 0) then 
      { key: ($stagePrefix + "cycleSuccessRate"), value: .value.cyclesSummaries.all.cycleSuccessRate },
      { key: ($stagePrefix + "cycleAvgDuration"), value: .value.cyclesSummaries.all.avgDuration },
      { key: ($stagePrefix + "avgSwingsetBlockTime"), value: .value.blocksSummaries.onlyLive.avgSwingsetTime },
      { key: ($stagePrefix + "avgSwingsetPercentage"), value: .value.blocksSummaries.onlyLive.avgSwingsetPercentage },
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