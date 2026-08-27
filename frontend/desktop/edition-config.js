const path = require("node:path");

const LOCAL_PRODUCT = Object.freeze({
  edition: "local",
  appId: "com.xuanxiaotech.todo",
  productName: "AetherX",
  userDataDirectoryName: "AetherX"
});

const CLOUD_PRODUCT = Object.freeze({
  edition: "cloud",
  appId: "com.xuanxiaotech.aetherx.online.desktop",
  productName: "AetherX Online",
  userDataDirectoryName: "AetherX Online",
  officialServerUrl: "https://api.aetherx.tech"
});

function isCloudDesktopEdition({ argv = [], env = {}, packageMetadata = {} } = {}) {
  return packageMetadata.aetherxEdition === "cloud" ||
    argv.includes("--cloud") ||
    String(env.AETHERX_DESKTOP_EDITION || env.AETHERX_EDITION || "local").toLowerCase() === "cloud";
}

function resolveDesktopServerUrl({ cloudEdition, packaged, env = {}, localServerUrl }) {
  if (!cloudEdition) {
    return env.AETHERX_SERVER_URL || env.XUANAI_SERVER_URL || localServerUrl;
  }
  if (packaged) return CLOUD_PRODUCT.officialServerUrl;
  return env.AETHERX_CLOUD_SERVER_URL || env.AETHERX_SERVER_URL || CLOUD_PRODUCT.officialServerUrl;
}

function cloudUserDataPath(appDataPath) {
  return path.join(appDataPath, CLOUD_PRODUCT.userDataDirectoryName);
}

module.exports = {
  CLOUD_PRODUCT,
  LOCAL_PRODUCT,
  cloudUserDataPath,
  isCloudDesktopEdition,
  resolveDesktopServerUrl
};
