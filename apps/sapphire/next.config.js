//@ts-check
const { composePlugins, withNx } = require('@nx/next');
const configValues = {
  default: {},
};
const configuration = process.env.NX_TASK_TARGET_CONFIGURATION || 'default';
const options = {
  ...configValues.default,
  // @ts-expect-error: Ignore TypeScript error for indexing configValues with a dynamic key
  ...configValues[configuration],
};
/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  output: 'standalone',
  nx: { ...options },
};
const plugins = [withNx];
module.exports = composePlugins(...plugins)(nextConfig);
