/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as clipper_auth from "../clipper/auth.js";
import type * as clipper_clipJobs from "../clipper/clipJobs.js";
import type * as clipper_helpers from "../clipper/helpers.js";
import type * as clipper_runs from "../clipper/runs.js";
import type * as clipper_tables from "../clipper/tables.js";
import type * as clipper_validators from "../clipper/validators.js";
import type * as common_functions_customFunctions from "../common/functions/customFunctions.js";
import type * as crons from "../crons.js";
import type * as finance_auth from "../finance/auth.js";
import type * as finance_items from "../finance/items.js";
import type * as finance_tables from "../finance/tables.js";
import type * as finance_validators from "../finance/validators.js";
import type * as game_codes from "../game/codes.js";
import type * as game_parties from "../game/parties.js";
import type * as game_players from "../game/players.js";
import type * as game_results from "../game/results.js";
import type * as game_scoring from "../game/scoring.js";
import type * as game_tables from "../game/tables.js";
import type * as game_validators from "../game/validators.js";
import type * as http from "../http.js";
import type * as notifications_auth from "../notifications/auth.js";
import type * as notifications_channels from "../notifications/channels.js";
import type * as notifications_devices from "../notifications/devices.js";
import type * as notifications_tables from "../notifications/tables.js";
import type * as notifications_validators from "../notifications/validators.js";
import type * as routes from "../routes.js";
import type * as ruby_auth from "../ruby/auth.js";
import type * as ruby_counts from "../ruby/counts.js";
import type * as ruby_phrases from "../ruby/phrases.js";
import type * as ruby_tables from "../ruby/tables.js";
import type * as sapphire_dashboard from "../sapphire/dashboard.js";
import type * as sapphire_tables from "../sapphire/tables.js";
import type * as sapphire_v1_readingList from "../sapphire/v1/readingList.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "clipper/auth": typeof clipper_auth;
  "clipper/clipJobs": typeof clipper_clipJobs;
  "clipper/helpers": typeof clipper_helpers;
  "clipper/runs": typeof clipper_runs;
  "clipper/tables": typeof clipper_tables;
  "clipper/validators": typeof clipper_validators;
  "common/functions/customFunctions": typeof common_functions_customFunctions;
  crons: typeof crons;
  "finance/auth": typeof finance_auth;
  "finance/items": typeof finance_items;
  "finance/tables": typeof finance_tables;
  "finance/validators": typeof finance_validators;
  "game/codes": typeof game_codes;
  "game/parties": typeof game_parties;
  "game/players": typeof game_players;
  "game/results": typeof game_results;
  "game/scoring": typeof game_scoring;
  "game/tables": typeof game_tables;
  "game/validators": typeof game_validators;
  http: typeof http;
  "notifications/auth": typeof notifications_auth;
  "notifications/channels": typeof notifications_channels;
  "notifications/devices": typeof notifications_devices;
  "notifications/tables": typeof notifications_tables;
  "notifications/validators": typeof notifications_validators;
  routes: typeof routes;
  "ruby/auth": typeof ruby_auth;
  "ruby/counts": typeof ruby_counts;
  "ruby/phrases": typeof ruby_phrases;
  "ruby/tables": typeof ruby_tables;
  "sapphire/dashboard": typeof sapphire_dashboard;
  "sapphire/tables": typeof sapphire_tables;
  "sapphire/v1/readingList": typeof sapphire_v1_readingList;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
