/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  authorizeOpenListDelete,
  deleteListedVideos,
  isOpenListDeleteEnabled,
  jsonError,
  listQualifiedVideos,
  removeFolderIfEmpty,
  resolveDeleteFolder,
  validateFileName,
} from '@/lib/openlist-delete';

export const runtime = 'nodejs';

// 超出上限明确拒绝，不截断后宣称“全部删除”。
const MAX_FILES = 10000;

/** 预览与确认使用同一授权目录，确认时重新列举，不能信任客户端提供的删除范围。 */
export async function POST(request: NextRequest) {
  if (!isOpenListDeleteEnabled()) return jsonError(404, 'Not Found');
  try {
    const auth = await authorizeOpenListDelete(request);
    if (auth instanceof NextResponse) return auth;
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, '请求体不是有效 JSON');
    }
    if (!body || !['preview', 'delete'].includes(body.action)) {
      return jsonError(400, 'action 必须为 preview 或 delete');
    }
    const folder = typeof body.folder === 'string' ? body.folder : '';
    const ctx = await resolveDeleteFolder(folder);
    if (ctx instanceof NextResponse) return ctx;

    let fileNames: string[];
    try {
      fileNames = (await listQualifiedVideos(ctx.client, folder, true))
        .map((item) => item.name).sort();
    } catch (error) {
      return jsonError(502, '列出主播全部视频失败（未删除任何文件）', (error as Error).message);
    }
    if (fileNames.length > MAX_FILES) {
      return jsonError(400, `主播视频超过 ${MAX_FILES} 个，无法一次删除（未删除任何文件）`);
    }
    if (body.action === 'preview') {
      return NextResponse.json({ fileNames }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const requested = body.fileNames;
    if (!Array.isArray(requested) || requested.length === 0 || requested.length > MAX_FILES ||
      requested.some((name) => typeof name !== 'string' || validateFileName(name) !== null) ||
      new Set(requested).size !== requested.length) {
      return jsonError(400, 'fileNames 必须是无重复的有效视频文件名列表');
    }
    const requestedSet = new Set(requested);
    if (fileNames.length !== requestedSet.size || fileNames.some((name) => !requestedSet.has(name))) {
      return NextResponse.json({
        error: '主播视频列表已变化，请重新预览后确认（未删除任何文件）',
        serverFileNames: fileNames,
      }, { status: 409 });
    }

    const result = await deleteListedVideos(ctx, folder, fileNames, auth, 'openlist/delete-streamer');
    if (result instanceof NextResponse) return result;
    // 失败文件可能是大小过滤隐藏的视频，不能按“无可见分集”把条目移除。
    const cleanup = result.failed.length === 0
      ? await removeFolderIfEmpty(ctx, folder, auth, 'openlist/delete-streamer', true)
      : { folderRemoved: false, remainingEpisodes: null };
    const success = result.failed.length === 0;
    return NextResponse.json({
      success,
      ...result,
      ...cleanup,
      ...(!success ? { error: `${result.failed.length} 个视频删除失败（成功 ${result.deleted.length} 个）` } : {}),
    }, { status: success ? 200 : 500 });
  } catch (error) {
    console.error('[openlist/delete-streamer] 删除失败:', error);
    return jsonError(500, '删除失败', (error as Error).message);
  }
}
