/** @jest-environment jsdom */
import { describe, expect, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import DeleteEpisodeDialog from './DeleteEpisodeDialog';

const props = () => ({
  isOpen: true, anchorName: '测试主播', episodeTitle: '录屏 A', fileName: 'a.mp4',
  broadcast: null, broadcastDisabledReason: '分组不可用', broadcastFallbackLabel: '删除本场直播',
  streamer: null as { fileNames: string[] } | null, isLoadingStreamer: false, streamerError: null as string | null,
  onPreviewStreamer: jest.fn(), isDeleting: false, error: null,
  onConfirm: jest.fn(), onCancel: jest.fn(),
});

describe('主播全部直播删除弹窗', () => {
  test('第三种删除范围先预览，加载失败不允许确认，也不依赖整场分组', () => {
    const p = props();
    const { rerender } = render(<DeleteEpisodeDialog {...p} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: /删除该主播全部直播/ }));
    expect(p.onPreviewStreamer).toHaveBeenCalledTimes(1);
    expect(p.onConfirm).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '确认删除全部视频' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<DeleteEpisodeDialog {...p} streamerError='目录读取失败' />);
    expect(screen.getByRole('alert').textContent).toContain('目录读取失败');
    expect((screen.getByRole('button', { name: '确认删除全部视频' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('预览包括小视频清单，必须二次确认；忙碌时不能取消或重复提交', () => {
    const p = props();
    const { rerender } = render(<DeleteEpisodeDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /删除该主播全部直播/ }));
    const streamer = { fileNames: ['a.mp4', 'tiny.mp4'] };
    rerender(<DeleteEpisodeDialog {...p} streamer={streamer} />);
    expect(screen.getByRole('list', { name: '将删除的全部视频' }).textContent).toContain('tiny.mp4');
    fireEvent.click(screen.getByRole('button', { name: '确认删除全部视频' }));
    expect(p.onConfirm).toHaveBeenCalledWith('streamer');
    rerender(<DeleteEpisodeDialog {...p} streamer={streamer} isDeleting />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onCancel).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('取消与重开不会继承上次确认步骤', () => {
    const p = props();
    const { rerender } = render(<DeleteEpisodeDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /删除该主播全部直播/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(p.onConfirm).not.toHaveBeenCalled();
    rerender(<DeleteEpisodeDialog {...p} isOpen={false} />);
    rerender(<DeleteEpisodeDialog {...p} />);
    expect(screen.getByRole('group', { name: '选择删除范围' })).toBeDefined();
  });
});
