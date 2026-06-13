select g.label, t.name, gs.pts, gs.goals_for , gs.goals_against , gs.real_position , gs.matches_played 
from group_standings gs 
inner join "groups" g on g.id = gs.group_id 
inner join teams t on t.id = gs.team_id 
where g.label = 'B'
order by real_position;