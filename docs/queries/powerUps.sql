 SELECT
    p.name,
    dh.name AS dark_horse_team,
    COALESCE(SUM(se.points) FILTER (
      WHERE se.param_key LIKE 'pts_dark_horse%'
    ), 0) AS dark_horse_points,
    dis.name AS disappointment_team,
    COALESCE(SUM(se.points) FILTER (
      WHERE se.param_key LIKE 'pts_disappointment%'
    ), 0) AS disappointment_points,
    COALESCE(SUM(se.points) FILTER (
      WHERE se.param_key LIKE 'pts_dark_horse%'
         OR se.param_key LIKE 'pts_disappointment%'
    ), 0) AS powerup_total
  FROM participants p
  JOIN powerups pw ON pw.participant_id = p.id
  JOIN teams dh  ON dh.id  = pw.dark_horse_team_id
  JOIN teams dis ON dis.id = pw.disappointment_team_id
  LEFT JOIN score_events se ON se.participant_id = p.id
  GROUP BY p.id, p.name, dh.name, dis.name
  ORDER BY powerup_total DESC;