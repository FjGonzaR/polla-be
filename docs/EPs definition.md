# Polla Mundial 2026 — Contexto de backend para Claude Code

## Descripción del producto

App privada de pronósticos para el Mundial 2026. Acceso por invitación, ~20 participantes.
Cada participante predice posiciones de fase de grupos, mejores terceros, powerups y marcadores exactos en eliminatorias.
El sistema asigna puntos según aciertos y mantiene un scoreboard con podio y premios en COP.

---

## Estructura del torneo

- 48 equipos en 12 grupos (A–L) de 4 equipos cada uno
- Clasifican: 2 primeros por grupo (24) + 8 mejores terceros = 32 equipos
- Rondas KO: Dieciseisavos → Octavos → Cuartos → Semifinales → Tercer puesto → Final
- Inicio: 11 de junio de 2026 · Final: 19 de julio de 2026

---

## Modelo de datos

### `participants`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| google_id | string UK | Llave de identidad única (SSO) |
| name | string | |
| email | string UK | |
| phone | string | Para WhatsApp. Nullable hasta que lo registre |
| has_phone | boolean | Flag para que el frontend sepa si debe pedir el teléfono post-login |
| invitation_code_used | string FK | Código que usó para registrarse |
| created_at | timestamp | |

### `invitations`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| code | string UK | Código de un solo uso, generado por el Admin |
| status | enum | `available` / `used` |
| used_by_participant_id | uuid FK nullable | |
| used_at | timestamp nullable | |
| created_at | timestamp | |

### `groups`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| name | string | Ej: "Grupo A" |
| label | string | Ej: "A" |

### `teams`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| name | string | Nombre oficial |
| code | string | Código ISO 3 letras |
| is_top8 | boolean | Foto fija definida por el Admin antes del torneo |
| group_id | uuid FK | |

### `rounds`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| name | string | Ej: "Dieciseisavos" |
| slug | string UK | Ej: `r32`, `r16`, `qf`, `sf`, `3rd`, `final` |
| order | int | Para ordenar las rondas |
| match_count | int | 16 / 8 / 4 / 2 / 1 / 1 |

**Valores iniciales de `rounds`:**
```
order 1 → Dieciseisavos  (slug: r32,   match_count: 16)
order 2 → Octavos        (slug: r16,   match_count: 8)
order 3 → Cuartos        (slug: qf,    match_count: 4)
order 4 → Semifinales    (slug: sf,    match_count: 2)
order 5 → Tercer puesto  (slug: 3rd,   match_count: 1)
order 6 → Final          (slug: final, match_count: 1)
```

### `matches`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| round_id | uuid FK | |
| match_number | int | Número de partido dentro de la ronda |
| home_team_id | uuid FK nullable | Se carga cuando se conocen los cruces |
| away_team_id | uuid FK nullable | Ídem |
| scheduled_at | timestamp | Hora oficial de inicio |
| locked_at | timestamp | `scheduled_at - 30 min`. El cron lo setea |
| reminder_sent | boolean | Flag para no duplicar el WhatsApp |
| score_home | int nullable | Resultado oficial a 120' |
| score_away | int nullable | Resultado oficial a 120' |
| winner_team_id | uuid FK nullable | Equipo que clasifica (puede diferir del marcador si hay penales) |
| status | enum | `scheduled` / `live` / `finished` |

### `group_predictions`
Permite guardar progreso grupo a grupo (un registro por equipo × grupo × participante).

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| participant_id | uuid FK | |
| group_id | uuid FK | |
| team_id | uuid FK | |
| predicted_position | int | 1, 2, 3 o 4 |
| created_at | timestamp | |
| updated_at | timestamp | |

Constraint único: `(participant_id, group_id, team_id)` y `(participant_id, group_id, predicted_position)`.

### `third_predictions`
Los 8 mejores terceros que el participante cree que clasificarán.

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| participant_id | uuid FK | |
| team_id | uuid FK | Debe ser un equipo que el participante predijo en posición 3 en algún grupo |
| created_at | timestamp | |

Constraint único: `(participant_id, team_id)`. Máximo 8 registros por participante.

### `powerups`
Un registro por participante. Se crea junto con el primer guardado.

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| participant_id | uuid FK UK | |
| dark_horse_team_id | uuid FK | Caballo negro. Debe tener `is_top8 = false` |
| disappointment_team_id | uuid FK | Decepción. Debe tener `is_top8 = true` |
| created_at | timestamp | |
| updated_at | timestamp | |

### `ko_predictions`
Un registro por partido × participante.

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| participant_id | uuid FK | |
| match_id | uuid FK | |
| score_home | int | Marcador pronosticado (resultado a 120') |
| score_away | int | |
| team_advances_id | uuid FK | Equipo que el participante cree que clasifica |
| triple_active | boolean | Default false. Máximo 3 activos por participante en todo el torneo |
| created_at | timestamp | |
| updated_at | timestamp | |

Constraint único: `(participant_id, match_id)`.

### `scoring_params`
Tabla de parámetros editables por el Admin.

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| key | string UK | Identificador del parámetro |
| value | numeric | Valor actual |
| description | string | Descripción legible |
| updated_at | timestamp | |

**Claves iniciales sugeridas:**
```
pts_group_position_exact   → puntos por equipo en posición correcta
pts_group_position_partial → puntos si el equipo clasifica pero en diferente posición
bonus_group_complete       → bonus si los 4 equipos del grupo están en posición correcta
pts_third_correct          → puntos por cada mejor tercero acertado
pts_ko_advances            → puntos por acertar quién pasa (sin importar marcador)
pts_ko_exact_score         → puntos por marcador exacto (120')
pts_dark_horse_per_round   → puntos por cada ronda que avanza el caballo negro
pts_disappointment_per_round → puntos que se restan por cada ronda que avanza la decepción
mult_triple                → multiplicador triple o nada (default: 3)
scale_r32                  → multiplicador de ronda para dieciseisavos (default: 1)
scale_r16                  → multiplicador para octavos (default: 1.5)
scale_qf                   → multiplicador para cuartos (default: 2)
scale_sf                   → multiplicador para semifinales (default: 3)
scale_final                → multiplicador para final (default: 4)
```

---

## Reglas de negocio críticas

### Candados (locking)
- **Fase de grupos + terceros + powerups**: se bloquean antes del primer partido (11 de junio 2026). Validar contra `scheduled_at` del primer `match` del torneo.
- **Cada partido KO**: se bloquea 30 minutos antes de su inicio (`match.locked_at = scheduled_at - 30min`).
- Cualquier intento de escritura sobre una predicción bloqueada retorna `423 Locked`.

### Triple o nada
- Máximo 3 activaciones por participante en toda la fase KO.
- Si `triple_active = true` y se acierta el marcador exacto → puntos × `mult_triple`.
- Si `triple_active = true` y NO se acierta el marcador exacto → 0 puntos en ese partido (aunque se acierte quién pasa).

### Powerups
- `dark_horse_team_id` → equipo con `is_top8 = false`. Solo suma puntos.
- `disappointment_team_id` → equipo con `is_top8 = true`. Solo resta puntos.
- Ambos obligatorios. Se guardan en el mismo request.

### Candidatos a mejores terceros
- Los candidatos son los equipos que el participante predijo en `predicted_position = 3` en los 12 grupos.
- `GET /groups/thirds` retorna los candidatos con flag `selected: true/false` y `selectedCount`.
- `POST /groups/thirds` recibe exactamente 8 `teamIds`. El BE valida que sean subconjunto de los candidatos del participante.

### Visibilidad de pronósticos de amigos
- `GET /groups/predictions/friends` → disponible solo si `NOW() >= scheduled_at` del primer partido.
- `GET /ko/matches/:matchId/predictions/friends` → disponible solo si `NOW() >= match.scheduled_at`.

### Marcador KO
- `score_home` y `score_away` representan el resultado a 120' (incluyendo tiempo extra si aplica).
- `winner_team_id` puede diferir del marcador si el partido se define por penales.
- Los puntos de `pts_ko_advances` se dan por `team_advances_id` correcto, independientemente del marcador.
- Los puntos de `pts_ko_exact_score` requieren que tanto el marcador como `team_advances_id` coincidan.

### Scoreboard
- Se calcula on-demand al hacer `GET /scoreboard`.
- El cron `recalculate-scores` corre a la 1AM y precalcula/cachea el resultado para evitar carga en hora pico.
- Criterio de desempate: mayor cantidad de marcadores exactos (`ko_predictions` con score_home + score_away correctos).

---

## Endpoints

### Auth
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/google` | Login/Signup con SSO. Retorna token + flags `hasJoined` y `hasPhone`. Crea participante si es la primera vez. |
| POST | `/auth/join` | Asocia al participante a la polla mediante código de invitación. Requiere JWT. Se llama cuando `hasJoined = false`. |
| POST | `/auth/phone` | Registra teléfono del participante autenticado en formato E.164. Requiere JWT. Se llama cuando `hasPhone = false`. |

### Admin
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/admin/invitations` | Genera uno o varios códigos de un solo uso. |
| GET | `/admin/invitations` | Lista códigos con estado y a quién fue asignado. |
| POST | `/admin/groups` | Carga los 12 grupos con sus 4 equipos. Solo una vez. |
| POST | `/admin/ko/matches` | Carga los partidos de una ronda KO con equipos ya conocidos. Se usa ronda a ronda. |
| PUT | `/admin/ko/matches/:matchId/result` | Carga o corrige resultado oficial (`score_home`, `score_away`, `winner_team_id`). Dispara recalculate. |
| PUT | `/admin/scoring-params/{key}` | Edita el valor de un parámetro de puntuación por su key. `key` es uno de los 14 valores de `scoring_params`. |
| PUT | `/admin/top8` | Actualiza el listado top 8 FIFA (foto fija). |
| GET | `/admin/participants` | Lista participantes con puntaje actual y datos de contacto. |

### Groups
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/groups` | Lista los 12 grupos con sus equipos y flag `is_top8` por equipo. |
| POST | `/groups/predictions` | Guarda o actualiza el orden predicho. Acepta un grupo o array de grupos. Body: `{ predictions: [{ group_id, rankings: [{ team_id, position }] }] }`. Valida candado. |
| GET | `/groups/predictions/me` | Predicciones propias: orden por grupo + flag `groupComplete` + contador `completedGroups`. |
| GET | `/groups/predictions/friends` | Predicciones de todos los demás participantes. Solo disponible post-inicio del torneo. |
| GET | `/groups/thirds` | Candidatos a mejores terceros (equipos predichos en posición 3). Incluye flag `selected` y `pointsEarned`. |
| POST | `/groups/thirds` | Guarda o reemplaza la selección de exactamente 8 mejores terceros. Los teamIds deben ser candidatos válidos. Valida candado. |

### KO
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/ko/matches` | Lista partidos de una ronda (query param `roundSlug` requerido). Incluye resultado real y predicción propia del autenticado. Si `NOW() > scheduled_at + 90min` y no hay resultado, consulta API externa, guarda y retorna. |
| GET | `/ko/matches/:matchId` | Detalle de un partido con el mismo esquema. |
| POST | `/ko/matches/:matchId/predictions` | Registra `scoreHome`, `scoreAway`, `teamAdvancesId`. Opcionalmente `tripleActive: true`. Valida candado y usos de triple. |
| PUT | `/ko/matches/:matchId/predictions` | Edita el pronóstico. `tripleActive` incluido en el body. Valida candado y usos de triple si cambia de false a true. |
| GET | `/ko/matches/:matchId/predictions/friends` | Pronósticos de todos los demás para ese partido. Solo visible una vez iniciado el partido (`NOW() >= match.scheduledAt`). |

### Powerups
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/powerups/predictions` | Registra caballo negro y decepción. Valida elegibilidad y candado. |
| PUT | `/powerups/predictions` | Edita caballo negro y/o decepción. Valida candado. |
| GET | `/powerups/predictions/me` | Powerups del participante autenticado con detalle del equipo. |
| GET | `/powerups/predictions/friends` | Powerups de todos los demás participantes. Solo visible post-inicio del torneo. |

### Scoreboard
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/scoreboard` | Tabla de posiciones completa ordenada por puntaje. Incluye `prize` para rank 1–3 (700K / 250K / 50K COP). Usa caché si el cron ya corrió. |
| GET | `/scoreboard/:participantId/breakdown` | Desglose detallado de puntaje por fase (groups, thirds, ko, darkHorse, disappointment) de cualquier participante. |

---

## Crons

| Nombre | Frecuencia | Descripción |
|---|---|---|
| `cron:lock-match` | Cada minuto | Para cada partido KO en estado `scheduled` sin `locked_at`, setea `locked_at = scheduled_at - 30min` cuando `NOW() >= scheduled_at - 30min`. |
| `cron:whatsapp-reminder` | Cada 30 min | Busca partidos que inician en la próxima hora. Por cada uno, envía WhatsApp a participantes sin pronóstico para ese partido. Setea `reminder_sent = true` por partido×participante para no duplicar. |
| `cron:fetch-results` | Cada 30 min entre 12PM–1AM | Consulta API externa para partidos con `status = live` o cuyo `scheduled_at + 90min` ya pasó sin resultado. Guarda `score_home`, `score_away`, `winner_team_id` y cambia `status = finished`. |
| `cron:recalculate-scores` | 1AM diario | Recalcula y cachea puntajes de todos los participantes. El scoreboard también puede calcularlo on-demand para el primer request post-resultado. |

---

## Notas de implementación

- Todos los endpoints de predicción validan el candado antes de escribir. Respuesta en caso de bloqueo: `423 Locked`.
- La fuente de resultados primaria es la API externa (worldcup2026 en GitHub o API-Football). El Admin puede cargar resultados manualmente como fallback vía `PUT /admin/ko/matches/:matchId/result`.
- Las notificaciones de WhatsApp usan librería open source (tipo whatsapp-web.js). Requiere número dedicado y sesión activa. Fallback: el Admin envía manualmente.
- El Admin puede también participar como predictor. Sus predicciones siguen las mismas reglas. Los resultados los carga después del partido para evitar conflicto de interés.
- `scoring_params` se lee en cada cálculo de puntaje. Si el Admin edita los valores, el siguiente `GET /scoreboard` o la siguiente corrida del cron reflejan el cambio.