const NodeEnvironment = require('jest-environment-node');

// Jest 27 的沙箱未暴露 Node 原生 Fetch API，NextRequest/NextResponse 需要这些类。
module.exports = class NodeFetchEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    Object.assign(this.global, {
      Request, Response, Headers, fetch, TextEncoder, TextDecoder,
    });
  }
};
