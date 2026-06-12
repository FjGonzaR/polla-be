export interface WorldCupStandingTeam {
  team_id: string
  pts: string
  gf: string
  ga: string
  gd: string
  mp: string
}

export interface WorldCupStanding {
  _id: string
  name: string
  teams: WorldCupStandingTeam[]
}

export interface WorldCupTeam {
  _id: string
  id: string
  name_en: string
  fifa_code: string
  groups: string
  flag: string
}

export interface WorldCupMatch {
  _id: string
  id: string
  home_team_id: string
  away_team_id: string
  home_score: string
  away_score: string
  home_scorers?: string
  away_scorers?: string
  group?: string
  matchday?: string
  stadium_id?: string
  finished: string
  type: string
  home_team_label?: string
  away_team_label?: string
  time_elapsed: string
  local_date: string
}

export interface WorldCupStadium {
  _id: string
  id: string
  name_en: string
  city_en: string
  country_en: string
  capacity: number
}
