/**
 * orca MCP server over stdio. Agents run it as a global MCP server; ask_user
 * blocks on the hub socket until the Question is answered or the wait runs out.
 *
 * Usage: orca-mcp [--account DIR] [--socket PATH]
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { homedir } from 'node:os';
import { mcpConfig } from './config';
import { socketHubLink } from './hub-link';
import { createOrcaMcpServer } from './server';

const config = mcpConfig(process.argv.slice(2), (k) => process.env[k], homedir());
const server = createOrcaMcpServer({ hub: socketHubLink(config.socketPath), account: config.account, cwd: process.cwd() });
await server.connect(new StdioServerTransport());
