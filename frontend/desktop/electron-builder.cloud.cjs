const packageMetadata = require("./package.json");
const { CLOUD_PRODUCT } = require("./edition-config");

const base = packageMetadata.build;
const { include: _localInstallerInclude, ...cloudNsis } = base.nsis;

module.exports = {
  ...base,
  appId: CLOUD_PRODUCT.appId,
  productName: CLOUD_PRODUCT.productName,
  directories: {
    ...base.directories,
    output: "dist-cloud"
  },
  extraMetadata: {
    aetherxEdition: "cloud"
  },
  extraResources: [],
  nsis: {
    ...cloudNsis,
    shortcutName: CLOUD_PRODUCT.productName
  }
};
