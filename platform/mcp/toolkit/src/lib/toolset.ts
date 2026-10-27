import type { McpServer } from '@modelcontextprotocol/server';

/**
 * One project's tools. mcp-service builds a fresh server for every request and registers each
 * toolset on it, so `register` should only declare tools: set up clients when the toolset is
 * created. Prefix tool names with the project (`thermo_...`) so toolsets can't collide.
 */
export type McpToolset = {
  /** For logs. */
  name: string;
  register: (server: McpServer) => void;
};
