// 针对 dyzb 的小范围回归，不加载生产 Next 配置，也不进行生产构建。Node >= 22.13。
module.exports = {
  testEnvironment: '<rootDir>/scripts/jest-node-fetch-environment.cjs',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.(t|j)sx?$': [
      require.resolve('next/dist/build/swc/jest-transformer'),
      { isEsmProject: false },
    ],
  },
  testMatch: [
    '**/openlist-segment-favorite.test.ts',
    '**/delete-streamer.test.ts',
    '**/DeleteEpisodeDialog.test.tsx',
    '**/segment-favorite-client.test.ts',
    '**/segment-favorite-card.test.tsx',
    '**/segment-favorite-storage.test.ts',
  ],
};
