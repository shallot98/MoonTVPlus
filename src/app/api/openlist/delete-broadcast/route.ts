/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { lookupBroadcast } from '@/lib/dyzb-broadcasts';
import { OpenListGetResponse } from '@/lib/openlist.client';
import {
  authorizeOpenListDelete,
  invalidateDeletedFileCaches,
  isOpenListDeleteEnabled,
  isOpenListNotFound,
  jsonError,
  listQualifiedVideos,
  removeFolderIfEmpty,
  resolveDeleteFolder,
  validateFileName,
} from '@/lib/openlist-delete';

export const runtime = 'nodejs';

const MAX_FILES = 500;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

/**
 * POST /api/openlist/delete-broadcast
 * body: { folder, broadcastKey, fileNames: string[] }
 * 从 OpenList 永久删除某主播「一整场直播」的全部分段（需 OPENLIST_ALLOW_DELETE=1，仅 owner/admin）。
 *
 * - 服务端重新读取 broadcasts.json：该整场必须存在且 state === 'ok'
 * - 服务端集合 = 该目录中当前存在的合格分集（与详情接口同一过滤）里属于该整场的文件；
 *   必须与请求的 fileNames 完全一致（顺序无关），否则 409 并返回服务端集合
 * - 删除前逐个 fs/get 确认存在且是文件（任一不存在 → 409，不删任何文件）
 * - 逐个删除并逐个复查；有失败时 HTTP 500，返回 { deleted, failed }
 */
export async function POST(request: NextRequest) {
  if (!isOpenListDeleteEnabled()) {
    return jsonError(404, 'Not Found');
  }

  try {
    const auth = await authorizeOpenListDelete(request);
    if (auth instanceof NextResponse) return auth;

    let body: {
      folder?: unknown;
      broadcastKey?: unknown;
      fileNames?: unknown;
    } | null;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, '请求体不是有效 JSON');
    }
    const folder = typeof body?.folder === 'string' ? body.folder : '';
    const broadcastKey =
      typeof body?.broadcastKey === 'string' ? body.broadcastKey : '';
    const rawFileNames = body?.fileNames;

    if (
      !broadcastKey ||
      broadcastKey.length > 512 ||
      CONTROL_CHARS_RE.test(broadcastKey)
    ) {
      return jsonError(400, 'broadcastKey 无效');
    }
    if (
      !Array.isArray(rawFileNames) ||
      rawFileNames.length === 0 ||
      rawFileNames.length > MAX_FILES ||
      rawFileNames.some((n) => typeof n !== 'string')
    ) {
      return jsonError(400, `fileNames 必须为 1–${MAX_FILES} 个文件名`);
    }
    const fileNames = rawFileNames as string[];
    for (const name of fileNames) {
      const fileNameError = validateFileName(name);
      if (fileNameError) {
        return jsonError(400, `${fileNameError}：${name}`);
      }
    }
    if (new Set(fileNames).size !== fileNames.length) {
      return jsonError(400, 'fileNames 含重复文件名');
    }

    const ctx = await resolveDeleteFolder(folder);
    if (ctx instanceof NextResponse) return ctx;
    const { client, openListConfig } = ctx;

    // 1. 重新读取 broadcasts.json
    const lookup = await lookupBroadcast(folder, broadcastKey);
    if (lookup.unavailable) {
      return jsonError(503, '整场分组数据（broadcasts.json）不可用');
    }
    const broadcast = lookup.broadcast;
    if (!broadcast) {
      return NextResponse.json(
        { error: '未找到该整场，分组可能已更新，请刷新后重试', serverFileNames: [] },
        { status: 409 }
      );
    }
    if (broadcast.state !== 'ok') {
      return NextResponse.json(
        {
          error: '本场分段时长还在统计，暂时无法准确判断整场范围',
          state: broadcast.state,
        },
        { status: 409 }
      );
    }

    // 2. 服务端集合：目录中当前存在的合格分集 ∩ 该整场
    let listed: { name: string; size: number }[];
    try {
      listed = await listQualifiedVideos(client, folder);
    } catch (error) {
      return jsonError(502, '列出 OpenList 目录失败', (error as Error).message);
    }
    const inBroadcast = new Set(broadcast.fileNames);
    const serverFileNames = listed
      .map((item) => item.name)
      .filter((name) => inBroadcast.has(name))
      .sort((a, b) => a.localeCompare(b));

    const requested = new Set(fileNames);
    const sameSet =
      serverFileNames.length === requested.size &&
      serverFileNames.every((name) => requested.has(name));
    if (!sameSet) {
      return NextResponse.json(
        {
          error: '整场文件列表与服务端不一致，请刷新后重试',
          serverFileNames,
        },
        { status: 409 }
      );
    }

    // 3. 删除前逐个确认存在且是文件；任一不存在则不删任何文件
    for (const name of serverFileNames) {
      const filePath = `${folder}/${name}`;
      let before: OpenListGetResponse;
      try {
        before = await client.getFile(filePath);
      } catch (error) {
        return jsonError(
          502,
          '查询 OpenList 文件失败（未删除任何文件）',
          `${name}: ${(error as Error).message}`
        );
      }
      if (before.code !== 200) {
        if (isOpenListNotFound(before.message)) {
          return NextResponse.json(
            {
              error: '文件不存在，请刷新后重试（未删除任何文件）',
              details: name,
              serverFileNames,
            },
            { status: 409 }
          );
        }
        return jsonError(
          502,
          '查询 OpenList 文件失败（未删除任何文件）',
          `${name}: code=${before.code} ${before.message || ''}`.trim()
        );
      }
      if (!before.data || before.data.is_dir) {
        return NextResponse.json(
          {
            error: '目标不是文件，请刷新后重试（未删除任何文件）',
            details: name,
            serverFileNames,
          },
          { status: 409 }
        );
      }
    }

    // 4. 逐个删除并复查（OpenList 对不存在的文件也返回 200，必须二次确认）
    const deleted: string[] = [];
    const failed: { name: string; error: string }[] = [];
    for (const name of serverFileNames) {
      const filePath = `${folder}/${name}`;
      let error = '';
      try {
        const removeResult = await client.removeEntries(folder, [name]);
        if (removeResult.code !== 200) {
          error = `OpenList 删除失败: code=${removeResult.code} ${removeResult.message || ''}`.trim();
        }
      } catch (err) {
        error = `OpenList 删除失败: ${(err as Error).message}`;
      }

      if (!error) {
        try {
          const after = await client.getFile(filePath);
          if (after.code === 200) {
            error = 'OpenList 返回删除成功，但文件仍然存在';
          } else if (!isOpenListNotFound(after.message)) {
            error = `删除后复查异常: code=${after.code} ${after.message || ''}`.trim();
          }
        } catch (err) {
          error = `删除后复查失败: ${(err as Error).message}`;
        }
      }

      if (error) {
        failed.push({ name, error });
        console.error(
          `[openlist/delete-broadcast] 审计: user=${auth.username} role=${auth.role} 删除失败 ${filePath}（整场 ${broadcastKey}）: ${error}`
        );
      } else {
        deleted.push(name);
        console.log(
          `[openlist/delete-broadcast] 审计: user=${auth.username} role=${auth.role} 删除 OpenList 文件 ${filePath}（整场 ${broadcastKey}，OpenList=${openListConfig.URL} 账号=${openListConfig.Username}）`
        );
      }
    }

    // 5. 清理缓存 + 空文件夹移除（仅在确有文件被删除时）
    let remainingEpisodes: number | null = null;
    let folderRemoved = false;
    let warning: string | undefined;
    if (deleted.length > 0) {
      invalidateDeletedFileCaches(
        ctx,
        folder,
        deleted.map((name) => `${folder}/${name}`)
      );
      ({ remainingEpisodes, folderRemoved, warning } = await removeFolderIfEmpty(
        ctx,
        folder,
        auth,
        'openlist/delete-broadcast'
      ));
    }

    const payload = {
      success: failed.length === 0,
      deleted,
      failed,
      remainingEpisodes,
      folderRemoved,
      ...(warning ? { warning } : {}),
      ...(failed.length > 0
        ? { error: `${failed.length} 个文件删除失败（成功 ${deleted.length} 个）` }
        : {}),
    };
    return NextResponse.json(payload, { status: failed.length > 0 ? 500 : 200 });
  } catch (error) {
    console.error('[openlist/delete-broadcast] 删除失败:', error);
    return jsonError(500, '删除失败', (error as Error).message);
  }
}
