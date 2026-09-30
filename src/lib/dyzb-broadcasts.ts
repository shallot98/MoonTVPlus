/* eslint-disable no-console */

/**
 * dyzb 导出的「整场直播」分组（DYZB_BROADCASTS_JSON 指向 broadcasts.json）。
 *
 * 文件结构：
 *   { version, generatedAt, gapMinutes, root, folders: { "<相对 root 的目录>": { "<文件名>": { b, bi, start, end, state, segs, dur } } } }
 *
 * - 按 mtime+size 缓存，文件变化才重读
 * - 未配置 / 缺失 / 解析失败时返回 null（调用方不分组），并 console.warn 一次（恢复后再失败会再次提示）
 */
import { promises as fs } from 'fs';

import type { EpisodeBroadcastGroup } from '@/lib/types';

export type { EpisodeBroadcastGroup };

interface BroadcastEntry {
  b: string;
  bi?: number;
  start: string;
  end?: string | null;
  state?: string;
  segs?: number;
  dur?: number | null;
}

interface BroadcastsFile {
  folders: Record<string, Record<string, BroadcastEntry>>;
}

let cache: { path: string; mtimeMs: number; size: number; data: BroadcastsFile } | null =
  null;
let warned = false;

function warnOnce(message: string) {
  if (warned) return;
  warned = true;
  console.warn(`[dyzb-broadcasts] ${message}（选集不按整场分组）`);
}

async function loadBroadcasts(): Promise<BroadcastsFile | null> {
  const filePath = process.env.DYZB_BROADCASTS_JSON;
  if (!filePath) return null;
  try {
    const stat = await fs.stat(filePath);
    if (
      cache &&
      cache.path === filePath &&
      cache.mtimeMs === stat.mtimeMs &&
      cache.size === stat.size
    ) {
      return cache.data;
    }
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed.folders !== 'object' || parsed.folders === null) {
      throw new Error('缺少 folders 字段');
    }
    cache = { path: filePath, mtimeMs: stat.mtimeMs, size: stat.size, data: parsed };
    warned = false;
    return cache.data;
  } catch (error) {
    cache = null;
    warnOnce(`读取 ${filePath} 失败: ${(error as Error).message}`);
    return null;
  }
}

/**
 * OpenList 分集 folder 参数（如 `/抖音/金宝`、`/没有冰`）→ broadcasts.json 的目录键。
 * MoonTVPlus 使用的 OpenList 账号 base_path 即 broadcasts.json 的 root，
 * 所以去掉首尾 `/` 即为相对 root 的目录键（`抖音/金宝`、`没有冰`）。
 */
export function folderToBroadcastKey(folder: string): string {
  return folder.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * 与 fileNames 等长的整场分组；未启用或该目录无数据时返回 undefined（接口不返回该字段）。
 */
export async function buildEpisodesGroups(
  folder: string,
  fileNames: string[]
): Promise<(EpisodeBroadcastGroup | null)[] | undefined> {
  const data = await loadBroadcasts();
  if (!data) return undefined;
  const entries = data.folders[folderToBroadcastKey(folder)];
  if (!entries) return undefined;

  const groups = fileNames.map((name) => {
    const e = entries[name];
    if (!e || typeof e.b !== 'string' || !e.b) return null;
    return {
      key: e.b,
      index: typeof e.bi === 'number' ? e.bi : 0,
      start: e.start,
      end: e.end ?? null,
      state: e.state || 'pending',
      segs: typeof e.segs === 'number' ? e.segs : 1,
      dur: typeof e.dur === 'number' ? e.dur : null,
    };
  });
  return groups.some((g) => g !== null) ? groups : undefined;
}
