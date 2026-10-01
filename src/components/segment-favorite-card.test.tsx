/** @jest-environment jsdom */
import { describe, expect, test } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

jest.mock('@/lib/db.client', () => ({
  clearAllFavorites: jest.fn(), getAllFavorites: jest.fn(), getAllPlayRecords: jest.fn(),
  subscribeToDataUpdates: () => () => undefined,
}));
jest.mock('./VideoCard', () => ({ __esModule: true, default: jest.fn((props) => <div>{props.title}</div>) }));
import { getAllFavorites, getAllPlayRecords } from '@/lib/db.client';
import { makeOpenListSegmentFavoriteId } from '@/lib/openlist-segment-favorite';
import { FavoritesPanel } from './FavoritesPanel';
import VideoCard from './VideoCard';

describe('收藏面板的分段数据', () => {
  test('同主播两段独立显示，传递稳定定位到卡片，不被整项续播下标替代', async () => {
    const a = { contentId: 'original', folder: '/主播', fileName: 'a.mp4', title: '片段 A' };
    const b = { ...a, fileName: 'b.mp4', title: '片段 B' };
    const favorites = Object.fromEntries([a, b].map((segment, i) => [
      `openlist+${makeOpenListSegmentFavoriteId(segment.folder, segment.fileName)}`,
      { title: `主播 · ${segment.title}`, year: '', cover: '', source_name: '私人影库', total_episodes: 1, save_time: i, segment },
    ]));
    (getAllFavorites as jest.Mock).mockResolvedValue(favorites);
    (getAllPlayRecords as jest.Mock).mockResolvedValue({ 'openlist+original': { index: 99 } });
    render(<FavoritesPanel isOpen onClose={() => undefined} />);
    await screen.findByText('主播 · 片段 A');
    expect(screen.getByText('主播 · 片段 B')).toBeDefined();
    await waitFor(() => expect(VideoCard).toHaveBeenCalled());
    const calls = (VideoCard as unknown as jest.Mock).mock.calls.map(([props]) => props);
    expect(calls.some((props) => props.segment?.fileName === 'a.mp4' && props.segment.contentId === 'original')).toBe(true);
    expect(calls.some((props) => props.segment?.fileName === 'b.mp4')).toBe(true);
    expect(calls.every((props) => props.currentEpisode !== 99)).toBe(true);
  });
});
