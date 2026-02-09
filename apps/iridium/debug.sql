  -- Which filters are rejecting the most?
  SELECT metadata->>'filter' AS filter, COUNT(*)
  FROM osmium.events
  WHERE name = 'debug-filter-reject' AND source = 'iridium'
  GROUP BY 1 ORDER BY 2 DESC;

  -- Linear regression slope distribution (are thresholds too tight?)
  SELECT
    metadata->>'conditionId' AS cid,
    (metadata->>'yesSlopePerSec')::float AS yes_slope,
    (metadata->>'noSlopePerSec')::float AS no_slope,
    (metadata->>'passed')::boolean AS passed
  FROM osmium.events
  WHERE name = 'debug-linreg-eval' AND source = 'iridium'
  ORDER BY created_at DESC LIMIT 100;

  -- OBI ratio distribution
  SELECT
    (metadata->>'yesRatio')::float AS yes_ratio,
    (metadata->>'noRatio')::float AS no_ratio,
    (metadata->>'passed')::boolean AS passed
  FROM osmium.events
  WHERE name = 'debug-obi-eval' AND source = 'iridium'
  ORDER BY created_at DESC LIMIT 100;

  -- Toxic flow detections
  SELECT
    metadata->>'conditionId' AS cid,
    metadata->>'side' AS side,
    (metadata->>'sellRatio')::float AS sell_ratio,
    (metadata->>'sellCount')::int AS sells,
    (metadata->>'recentTradeCount')::int AS total
  FROM osmium.events
  WHERE name = 'debug-toxic-flow-eval' AND (metadata->>'toxic')::boolean = true
  ORDER BY created_at DESC;

  -- Book update source ratio (are price_change events firing?)
  SELECT metadata->>'source' AS source, COUNT(*)
  FROM osmium.events
  WHERE name = 'debug-book-update' AND source = 'iridium'
  GROUP BY 1;

  -- How often do ticks pass all filters?
  SELECT COUNT(*) AS passed FROM osmium.events
  WHERE name = 'debug-filter-pass-all' AND source = 'iridium';
