/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access_admin from "../access/admin.js";
import type * as access_apps from "../access/apps.js";
import type * as access_emails from "../access/emails.js";
import type * as access_functions from "../access/functions.js";
import type * as access_helpers from "../access/helpers.js";
import type * as access_internal from "../access/internal.js";
import type * as access_tables from "../access/tables.js";
import type * as access_viewer from "../access/viewer.js";
import type * as album_albums from "../album/albums.js";
import type * as album_auth from "../album/auth.js";
import type * as album_helpers from "../album/helpers.js";
import type * as album_items from "../album/items.js";
import type * as album_media from "../album/media.js";
import type * as album_processing from "../album/processing.js";
import type * as album_scan from "../album/scan.js";
import type * as album_signing from "../album/signing.js";
import type * as album_slugs from "../album/slugs.js";
import type * as album_tables from "../album/tables.js";
import type * as album_validators from "../album/validators.js";
import type * as auth from "../auth.js";
import type * as clipper_auth from "../clipper/auth.js";
import type * as clipper_clipJobs from "../clipper/clipJobs.js";
import type * as clipper_helpers from "../clipper/helpers.js";
import type * as clipper_runs from "../clipper/runs.js";
import type * as clipper_tables from "../clipper/tables.js";
import type * as clipper_validators from "../clipper/validators.js";
import type * as common_functions_customFunctions from "../common/functions/customFunctions.js";
import type * as crons from "../crons.js";
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
  "access/admin": typeof access_admin;
  "access/apps": typeof access_apps;
  "access/emails": typeof access_emails;
  "access/functions": typeof access_functions;
  "access/helpers": typeof access_helpers;
  "access/internal": typeof access_internal;
  "access/tables": typeof access_tables;
  "access/viewer": typeof access_viewer;
  "album/albums": typeof album_albums;
  "album/auth": typeof album_auth;
  "album/helpers": typeof album_helpers;
  "album/items": typeof album_items;
  "album/media": typeof album_media;
  "album/processing": typeof album_processing;
  "album/scan": typeof album_scan;
  "album/signing": typeof album_signing;
  "album/slugs": typeof album_slugs;
  "album/tables": typeof album_tables;
  "album/validators": typeof album_validators;
  auth: typeof auth;
  "clipper/auth": typeof clipper_auth;
  "clipper/clipJobs": typeof clipper_clipJobs;
  "clipper/helpers": typeof clipper_helpers;
  "clipper/runs": typeof clipper_runs;
  "clipper/tables": typeof clipper_tables;
  "clipper/validators": typeof clipper_validators;
  "common/functions/customFunctions": typeof common_functions_customFunctions;
  crons: typeof crons;
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
