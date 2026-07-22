const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @anthropic-ai/sdk lazily imports node built-ins behind runtime guards
// (e.g. `await import('node:fs')` for file-path uploads, which the app
// never uses — photos are sent as base64). Metro resolves imports
// statically, so map node:* to empty modules instead of failing the build.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('node:')) {
    return { type: 'empty' };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
