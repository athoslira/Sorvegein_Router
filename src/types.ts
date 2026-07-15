export type ChatRole = 'user' | 'assistant';
export interface ChatMessage { role: ChatRole; content: string; }
export interface Usage { cost?: number; prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; }
export type SkillReference = { source: 'local'; path: string } | { source: 'github'; repository: string; ref: string; path: string };
export interface GatekeeperDecision { model: string; skill: SkillReference | null; }
export interface RouteResult { model: string; skill: SkillReference | null; note: string | null; }
