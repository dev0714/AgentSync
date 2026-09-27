import 'server-only';
import { githubFor, listPaths, readFile, type Installation } from './github';
import { serviceClient } from './supabase';

/**
 * Finding which Supabase project a repository uses, from the repository
 * itself: supabase/config.toml, the env example files, or the Supabase client
 * file — wherever `<ref>.supabase.co` or `project_id = "<ref>"` appears. The
 * person reviews the suggestions before anything is linked.
 */

const REF_URL = /https?:\/\/([a-z0-9]{20})\.supabase\.(?:co|in)/g;
const REF_TOML = /project_id\s*=\s*"([a-z0-9]{20})"/g;

/** Every Supabase project ref named in a piece of text. */
export function refsIn(text: string): string[] {
  const out = new Set<string>();
  for (const re of [REF_URL, REF_TOML]) for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** The files worth reading, most telling first; at most 10. */
export function candidateFiles(paths: string[]): string[] {
  const pick = (test: (p: string) => boolean) => paths.filter((p) => !/(^|\/)node_modules\//.test(p) && test(p));
  return [
    ...pick((p) => p === 'supabase/config.toml'),
    ...pick((p) => /(^|\/)\.env[^/]*\.(example|sample|template)$/i.test(p) || /(^|\/)(example|sample)\.env$/i.test(p)),
    ...pick((p) => /(^|\/)(src\/)?(lib|utils|integrations|services)\/supabase[^/]*(\/[^/]+)?\.(ts|tsx|js|mjs)$/i.test(p)).slice(0, 5),
    ...pick((p) => p === 'vercel.json' || p === 'README.md'),
  ].filter((p, i, all) => all.indexOf(p) === i).slice(0, 10);
}

type Context = {
  github: Installation | null;
  repository: { github_owner: string; repository: string; default_branch: string | null } | null;
};

export type Suggestion = {
  project_id: string;
  ref: string | null;
  source: string | null;
  /** A ref the repository names that the connected token cannot see. */
  unseen: string | null;
  error?: string;
};

export async function suggestForProject(projectId: string, visible: Set<string>): Promise<Suggestion> {
  const { data } = await serviceClient().rpc('agentsync_project_context', { p_project_id: projectId });
  const ctx = data as Context | null;
  if (!ctx?.repository || !ctx.github) return { project_id: projectId, ref: null, source: null, unseen: null, error: 'no repository' };
  const r = {
    owner: ctx.repository.github_owner,
    repo: ctx.repository.repository,
    defaultBranch: ctx.repository.default_branch || 'main',
  };
  try {
    const gh = await githubFor(ctx.github, r);
    const files = candidateFiles(await listPaths(gh, r, r.defaultBranch));
    let unseen: string | null = null;
    for (const path of files) {
      const text = await readFile(gh, r, path, r.defaultBranch);
      if (!text) continue;
      for (const ref of refsIn(text)) {
        if (visible.has(ref)) return { project_id: projectId, ref, source: path, unseen: null };
        unseen ??= ref;
      }
    }
    return { project_id: projectId, ref: null, source: null, unseen };
  } catch (e) {
    return { project_id: projectId, ref: null, source: null, unseen: null, error: (e as Error).message.slice(0, 200) };
  }
}
