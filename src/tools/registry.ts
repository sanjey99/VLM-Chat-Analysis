// src/tools/registry.ts
import type { ToolDefinition } from '../types'

export const TOOLS: ToolDefinition[] = [
  {
    name: 'location_search',
    description:
      'Search for locations, venues, or places in Singapore using natural language. Use this when the user asks to find specific places, restaurants, parks, cafes, or any location-based query. Returns a list of matching places.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to search for — e.g. "ramen restaurants", "parks", "coffee shops", "hawker centres"',
        },
        near: {
          type: 'string',
          description:
            'Area, neighbourhood, or MRT station in Singapore — e.g. "Bugis", "Tanjong Pagar", "Punggol". Omit if searching island-wide.',
        },
      },
      required: ['query'],
    },
  },
]

export function formatToolsForPrompt(tools: ToolDefinition[]): string {
  return tools
    .map(
      (t) =>
        `Tool: ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.parameters, null, 2)}`
    )
    .join('\n\n')
}
