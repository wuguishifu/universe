/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as common_functions_customFunctions from "../common/functions/customFunctions.js";
import type * as http from "../http.js";
import type * as routes from "../routes.js";
import type * as sapphire_tables from "../sapphire/tables.js";
import type * as sapphire_v1_readingList from "../sapphire/v1/readingList.js";
import type * as sapphire_v1_systemStatuses from "../sapphire/v1/systemStatuses.js";
import type * as silver_converter_audioConversions from "../silver/converter/audioConversions.js";
import type * as silver_tables from "../silver/tables.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "common/functions/customFunctions": typeof common_functions_customFunctions;
  http: typeof http;
  routes: typeof routes;
  "sapphire/tables": typeof sapphire_tables;
  "sapphire/v1/readingList": typeof sapphire_v1_readingList;
  "sapphire/v1/systemStatuses": typeof sapphire_v1_systemStatuses;
  "silver/converter/audioConversions": typeof silver_converter_audioConversions;
  "silver/tables": typeof silver_tables;
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
