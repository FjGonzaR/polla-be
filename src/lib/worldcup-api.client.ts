import type {
  WorldCupMatch,
  WorldCupStanding,
  WorldCupTeam,
} from "../types/worldcup-api.types.js";

const BASE_URL = process.env.WORLDCUP_API_URL ?? "https://worldcup26.ir";
const TIMEOUT_MS = 10_000;

class WorldCupApiClient {
  private async fetch<T>(path: string): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; polla-be/1.0)" },
      });
    } catch (err) {
      console.log(err);
      throw new Error(
        `WorldCup API request failed for ${url}: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`WorldCup API error ${res.status} for ${url}`);
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(`WorldCup API returned invalid JSON for ${url}`);
    }
  }

  async getStandings(): Promise<WorldCupStanding[]> {
    const data = await this.fetch<{ groups: WorldCupStanding[] }>(
      "/get/groups",
    );
    return data.groups;
  }

  async getTeams(): Promise<WorldCupTeam[]> {
    const data = await this.fetch<{ teams: WorldCupTeam[] }>("/get/teams");
    return data.teams;
  }

  async getMatch(externalMatchId: string): Promise<WorldCupMatch> {
    const data = await this.fetch<{ game: WorldCupMatch }>(
      `/get/game/${externalMatchId}`,
    );
    return data.game;
  }

  async getAllMatches(): Promise<WorldCupMatch[]> {
    const data = await this.fetch<{ games: WorldCupMatch[] }>("/get/games");
    return data.games;
  }
}

export const worldcupApi = new WorldCupApiClient();
